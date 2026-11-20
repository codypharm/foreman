// Reads every indexed circuit's netlist that hasn't been read yet, at the index's last block,
// and stores its bytes, counts and hashes (docs/decisions/2026-11-20-circuit-index.md,
// decision 4). Read only on chain. Safe to stop and run again: it carries on where it left off,
// and retries reads that failed. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL (.env).
//
//   pnpm --filter @foreman/index backfill [--limit N] [--concurrency N]
//
// About two calls per circuit (netlist and circuitInfo). Check the RPC plan's allowance first.

import { parseArgs } from "node:util";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { backfillNetlists, migrate } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const { values } = parseArgs({
	options: {
		limit: { type: "string" },
		concurrency: { type: "string", default: "10" },
	},
});
const limit = values.limit === undefined ? undefined : Number(values.limit);
const concurrency = Number(values.concurrency);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

	const client = createPublicClient({
		chain: bsc,
		transport: http(RPC, { retryCount: 5, timeout: 30_000 }),
	});
	const started = Date.now();
	let last = 0;
	const result = await backfillNetlists(pool, client, {
		...(limit === undefined ? {} : { limit }),
		concurrency,
		onProgress: (done, total) => {
			if (Date.now() - last < 15_000 && done < total) return;
			last = Date.now();
			const s = (Date.now() - started) / 1000;
			const eta = done ? Math.round(((total - done) * s) / done / 60) : "?";
			console.log(
				`${Math.round(s)} s: ${done} of ${total} circuits, about ${eta} min left`,
			);
		},
	});
	for (const f of result.failed) {
		console.log(
			`read failed, will retry: ${f.circuit.processor}/${f.circuit.id}: ${f.detail}`,
		);
	}
	console.log(
		`read ${result.read}, unreadable ${result.unreadable}, failed ${result.failed.length}, still unread ${result.remaining}; all at block ${result.atBlock}; ${Math.round((Date.now() - started) / 60_000)} min`,
	);
	if (result.failed.length) process.exitCode = 1;
} finally {
	await pool.end();
}
