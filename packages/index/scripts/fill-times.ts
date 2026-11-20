// Fills the times of rows saved before migration 004: each tape-out's from its TapedOut log,
// each design commitment's from its block (docs/decisions/2026-11-20-originality-result.md,
// decision 1). Read only on chain; safe to stop and run again. Needs BNB_ARCHIVE_RPC_URL and
// DATABASE_URL (.env).
//
//   pnpm --filter @foreman/index fill-times [--concurrency N]
//
// About 350 log reads for the tape-outs, then one block read per commitment block (about 7,600).

import { parseArgs } from "node:util";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import {
	type FillResult,
	fillCommitmentTimes,
	fillTapeOutTimes,
	migrate,
} from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
const { values } = parseArgs({
	options: { concurrency: { type: "string", default: "10" } },
});

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const client = createPublicClient({
		chain: bsc,
		transport: http(RPC, { retryCount: 5, timeout: 30_000 }),
	});
	const started = Date.now();
	const since = () => `${Math.round((Date.now() - started) / 1000)} s`;
	let last = 0;
	const every15s = (line: () => string) => {
		if (Date.now() - last < 15_000) return;
		last = Date.now();
		console.log(`${since()}: ${line()}`);
	};
	const report = (what: string, r: FillResult) => {
		console.log(
			`${since()}: ${what}: filled ${r.filled}, still without a time ${r.remaining}`,
		);
		if (r.failed) {
			console.log(`${what} stopped: ${r.failed}`);
			process.exitCode = 1;
		}
	};

	report(
		"tape-out times",
		await fillTapeOutTimes(pool, client, (s) => every15s(() => s)),
	);
	report(
		"commitment times",
		await fillCommitmentTimes(pool, client, {
			concurrency: Number(values.concurrency),
			onProgress: (done, total) =>
				every15s(() => `${done} of ${total} commitment blocks`),
		}),
	);
} finally {
	await pool.end();
}
