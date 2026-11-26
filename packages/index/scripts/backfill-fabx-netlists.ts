// Reads every stored FabX circuit's netlist that hasn't been read yet, at the block FabX's
// history is stored up to, and stores its bytes, counts and hashes with the same hash rule as
// BNB Chain's (docs/decisions/2026-11-25-fabx-storage.md). Read only on chain. Safe to stop and
// run again: it carries on where it left off, and retries reads that failed. Needs DATABASE_URL
// (.env); XLAYER_MAINNET_RPC_URL is optional, the public node otherwise (it serves old state).
//
//   pnpm --filter @foreman/index backfill-fabx-netlists [--limit N] [--concurrency N]
//
// Two calls per circuit (netlist and circuitInfo), bundled through Multicall3.

import { parseArgs } from "node:util";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import { backfillFabxNetlists, migrate } from "../src/index.ts";

const RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const { values } = parseArgs({
	options: {
		limit: { type: "string" },
		concurrency: { type: "string", default: "50" },
	},
});
const limit = values.limit === undefined ? undefined : Number(values.limit);
const concurrency = Number(values.concurrency);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

	const client = createPublicClient({
		chain: xLayer,
		batch: { multicall: true },
		transport: http(RPC, { retryCount: 5, timeout: 30_000 }),
	});
	const started = Date.now();
	let last = 0;
	const result = await backfillFabxNetlists(pool, client, {
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
		console.log(`read failed, will retry: FabX #${f.circuit.id}: ${f.detail}`);
	}
	console.log(
		`read ${result.read}, unreadable ${result.unreadable}, failed ${result.failed.length}, still unread ${result.remaining}; all at X Layer block ${result.atBlock}; ${Math.round((Date.now() - started) / 60_000)} min`,
	);
	if (result.failed.length) process.exitCode = 1;
} finally {
	await pool.end();
}
