// The Telegram bot on its own, for trying it locally (2026-11-26-telegram-alerts-for-pro.md): it
// answers commands, and sends copy alerts and Foreman Pro's reminders once at start and every 5 minutes from what the index
// already holds. It doesn't follow the chain: run the worker or the follow for fresh listings.
// Only one process may poll a bot token at a time, so stop the hosted worker's bot (unset its
// TELEGRAM_BOT_TOKEN) or use a second bot while this runs. The token is never logged.
//
//   pnpm --filter @foreman/api bot

import { xlayerMainnet } from "@foreman/chain-xlayer";
import pg from "pg";
import { sendProConfirmations } from "../src/alerts/confirm.ts";
import { pollCommands } from "../src/alerts/poll.ts";
import { sendProReminders } from "../src/alerts/reminders.ts";
import { sendAlerts } from "../src/alerts/send.ts";
import { telegramClient } from "../src/alerts/telegram.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
if (!TELEGRAM_BOT_TOKEN)
	throw new Error("TELEGRAM_BOT_TOKEN is not set (see .env.example)");

const log = (line: string) =>
	console.log(`${new Date().toISOString()} ${line}`);
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const telegram = telegramClient(TELEGRAM_BOT_TOKEN);
const stop = new AbortController();
const WEB_URL = process.env.WEB_URL ?? "https://foreman-eight-beta.vercel.app";

async function send() {
	try {
		const s = await sendAlerts(
			{
				pool,
				xlayer: xlayerMainnet(process.env.XLAYER_MAINNET_RPC_URL).client,
				telegram,
				webUrl: WEB_URL,
				now: Date.now,
			},
			log,
		);
		log(
			`alerts: ${s.sent} sent, ${s.failed} not sent, ${s.stopped} chats forgotten, ${s.paused} follows paused`,
		);
		const r = await sendProReminders(
			{ pool, telegram, webUrl: WEB_URL, now: Date.now },
			log,
		);
		log(`pro: ${r.sent} reminders sent, ${r.failed} not sent`);
	} catch (error) {
		log(
			`alerts: failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const timer = setInterval(send, 5 * 60_000);
const confirm = setInterval(async () => {
	try {
		const told = await sendProConfirmations({ pool, telegram }, log);
		if (told.sent || told.failed)
			log(`pro: ${told.sent} payments confirmed, ${told.failed} not sent`);
	} catch (error) {
		log(
			`pro: confirmations failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}, 30_000);
void send();
log("bot started: answering commands, sending alerts every 5 minutes");
process.on("SIGINT", async () => {
	clearInterval(timer);
	clearInterval(confirm);
	stop.abort();
	await pool.end();
	process.exit(0);
});
await pollCommands(
	{
		pool,
		telegram,
		now: Date.now,
		webUrl: WEB_URL,
	},
	stop.signal,
	log,
);
