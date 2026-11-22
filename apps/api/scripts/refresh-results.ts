// The results job, once (docs/decisions/2026-11-21-stored-results.md): rebuilds the stored results
// of every miner and listed circuit that the follow touched, or all of them when the last full
// rebuild is an hour old. Run it after the follow; the job runner will call the same function
// every 5 minutes once hosting is chosen. Read only on chain. Needs BNB_ARCHIVE_RPC_URL and
// DATABASE_URL.
//
//   pnpm --filter @foreman/api refresh-results [--mode auto|full|changes]

import { parseArgs } from "node:util";
import { bnbClient } from "@foreman/chain-bnb";
import { migrate } from "@foreman/index";
import pg from "pg";
import { refreshResults } from "../src/results/refresh.ts";

const { values } = parseArgs({ options: { mode: { type: "string" } } });
const mode = values.mode ?? "auto";
if (mode !== "auto" && mode !== "full" && mode !== "changes") {
	throw new Error("--mode must be auto, full or changes");
}
const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const client = bnbClient({
		archive: RPC,
		recent: process.env.BNB_RECENT_RPC_URL,
		archiveLogBlocks: process.env.BNB_ARCHIVE_LOG_BLOCKS,
		batch: true,
	});
	const started = Date.now();
	const run = await refreshResults(pool, client, {
		mode,
		now: BigInt(Math.floor(Date.now() / 1000)),
		onProgress: (done, of) => {
			if (done % 2_000 < 200 || done === of) console.log(`  ${done} / ${of}`);
		},
	});
	const took = `${Math.round((Date.now() - started) / 1000)} s`;
	if (!run.refreshed) {
		console.error(`${took}: stopped: ${run.detail}`);
		process.exitCode = 1;
	} else {
		console.log(
			`${took}: ${run.mode} rebuild at block ${run.indexBlock}: ${run.built} built, ${run.skipped.length} skipped, ${run.removed} removed`,
		);
		for (const s of run.skipped.slice(0, 10)) {
			console.log(
				`  skipped ${s.circuit.processor}/${s.circuit.id}: ${s.detail}`,
			);
		}
		if (run.skipped.length > 0) {
			console.log(
				"  a run with a skip moves no block: the next run tries again",
			);
		}
	}
} finally {
	await pool.end();
}
