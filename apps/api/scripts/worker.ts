// The hosted worker (docs/decisions/2026-11-23-hosting.md, decision 2): every 5 minutes, follow the
// index and FabX (2026-11-26-fabx-follow.md), refresh the results they touched, and publish what changed to the X Layer testnet. pg-boss
// keeps the schedule and a record of each run in Postgres, beside the index, and starts at most one
// run at a time: a run still going when the next is due leaves one waiting, never two running.
// It runs once at start too, so a deploy doesn't wait for the clock.
//
// Needs DATABASE_URL and BNB_ARCHIVE_RPC_URL (BNB_RECENT_RPC_URL, BNB_ARCHIVE_LOG_BLOCKS and
// XLAYER_RPC_URL as for the commands; XLAYER_MAINNET_RPC_URL optional, for FabX; PUBLISH_FABX=1
// publishes FabX results too). PUBLISHER_KEY, set on the host only, lets it publish; without
// it the publish stage is skipped. The key is never logged.
//
// TELEGRAM_BOT_TOKEN, set on the host only, turns on the Telegram bot: it answers commands while the
// worker runs and sends copy alerts after each run (2026-11-26-telegram-alerts-for-pro.md). WEB_URL
// is the web app the alerts link to. Without the token there is no bot. The token is never logged.
//
//   pnpm --filter @foreman/api worker

import { xlayerMainnet } from "@foreman/chain-xlayer";
import { migrate, recordStage } from "@foreman/index";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { FREE_FOLLOWS } from "../src/alerts/bot.ts";
import { pollCommands } from "../src/alerts/poll.ts";
import { sendAlerts } from "../src/alerts/send.ts";
import { telegramClient } from "../src/alerts/telegram.ts";
import { runCycle } from "../src/worker/cycle.ts";
import { workerStages } from "../src/worker/stages.ts";

const QUEUE = "follow-refresh-publish";
const EVERY_5_MINUTES = "*/5 * * * *";

const DATABASE_URL = process.env.DATABASE_URL;
const BNB_ARCHIVE_RPC_URL = process.env.BNB_ARCHIVE_RPC_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
if (!BNB_ARCHIVE_RPC_URL)
	throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");

const log = (line: string) =>
	console.log(`${new Date().toISOString()} ${line}`);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const applied = await migrate(pool);
if (applied.length) log(`migrations applied: ${applied.join(", ")}`);

const stages = workerStages(
	pool,
	{
		BNB_ARCHIVE_RPC_URL,
		BNB_RECENT_RPC_URL: process.env.BNB_RECENT_RPC_URL,
		BNB_ARCHIVE_LOG_BLOCKS: process.env.BNB_ARCHIVE_LOG_BLOCKS,
		XLAYER_RPC_URL: process.env.XLAYER_RPC_URL,
		XLAYER_MAINNET_RPC_URL: process.env.XLAYER_MAINNET_RPC_URL,
		PUBLISH_FABX: process.env.PUBLISH_FABX,
		PUBLISHER_KEY: process.env.PUBLISHER_KEY,
	},
	log,
);

// The Telegram bot, when its token is set. No chat has Foreman Pro until payments are built, so
// every chat follows one address.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_URL = process.env.WEB_URL ?? "https://foreman-eight-beta.vercel.app";
const telegram = TELEGRAM_BOT_TOKEN ? telegramClient(TELEGRAM_BOT_TOKEN) : null;
const botStop = new AbortController();
if (telegram) {
	void pollCommands(
		{ pool, telegram, limitFor: async () => FREE_FOLLOWS },
		botStop.signal,
		log,
	);
}

const boss = new PgBoss({ connectionString: DATABASE_URL });
boss.on("error", (error) => log(`pg-boss: ${error.message}`));
await boss.start();

const queue = {
	// One run waiting and one running at most; further sends while both are taken are dropped
	policy: "stately",
	// The next scheduled run is the retry, from the follow, on a fresh read of the chain
	retryLimit: 0,
	// A run stays claimed while this process is alive (pg-boss refreshes it every 30 s); if the
	// process dies, the run is failed within a minute and the next one can start
	heartbeatSeconds: 60,
	// A long catch-up after a gap can take hours; this is only the backstop
	expireInSeconds: 6 * 3600,
} as const;
if (await boss.getQueue(QUEUE)) {
	const { policy: _, heartbeatSeconds: __, ...updatable } = queue;
	await boss.updateQueue(QUEUE, updatable);
} else {
	await boss.createQueue(QUEUE, queue);
}
await boss.schedule(QUEUE, EVERY_5_MINUTES, null, { tz: "UTC" });

await boss.work(QUEUE, { localConcurrency: 1 }, async () => {
	const started = Date.now();
	log("run started");
	const report = await runCycle(stages, log);
	const took = `${Math.round((Date.now() - started) / 1000)} s`;
	// Each stage's outcome, for GET /health (hosting ADR, decision 7). A failed write is logged and
	// never fails the run: the chain reads and the publish have already happened.
	const at = BigInt(Math.floor(Date.now() / 1000));
	for (const { name, outcome } of report.stages) {
		try {
			await recordStage(
				pool,
				name,
				outcome.status === "done"
					? {
							status: "done",
							summary: [outcome.summary, ...(outcome.warnings ?? [])].join(
								"; ",
							),
						}
					: outcome,
				at,
			);
		} catch (error) {
			log(
				`couldn't record the ${name} outcome: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (!report.ok) {
		const failed = report.stages.at(-1);
		log(`run stopped after ${took}`);
		// Thrown so pg-boss records the run as failed, with the reason
		throw new Error(
			failed?.outcome.status === "failed"
				? `${failed.name}: ${failed.outcome.detail}`
				: "the run stopped",
		);
	}
	log(`run done in ${took}`);
	// Copy alerts after a whole run, from the listings and results it just saved. A failure is
	// logged and never fails the run; the next run tries again.
	if (telegram) {
		try {
			const sent = await sendAlerts(
				{
					pool,
					xlayer: xlayerMainnet(process.env.XLAYER_MAINNET_RPC_URL).client,
					telegram,
					webUrl: WEB_URL,
				},
				log,
			);
			log(
				`alerts: ${sent.sent} sent, ${sent.failed} not sent, ${sent.stopped} chats forgotten`,
			);
		} catch (error) {
			log(
				`alerts: failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
});
await boss.send(QUEUE, null);
log(
	`worker started: ${QUEUE} every 5 minutes (UTC)${process.env.PUBLISHER_KEY ? `, publishing to X Layer testnet${process.env.PUBLISH_FABX === "1" ? ", FabX results included" : ", FabX results not (PUBLISH_FABX unset)"}` : ", not publishing (no PUBLISHER_KEY)"}${telegram ? ", Telegram bot on" : ", no Telegram bot (no TELEGRAM_BOT_TOKEN)"}`,
);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, async () => {
		if (stopping) return;
		stopping = true;
		// A deploy sends SIGTERM: let a run in progress finish its current step, for up to 2 minutes
		log(`${signal}: stopping`);
		botStop.abort();
		await boss.stop({ graceful: true, timeout: 120_000 });
		await pool.end();
		process.exit(0);
	});
}
