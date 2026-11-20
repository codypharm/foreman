// Builds the index's tape-outs from the whole of BNB Chain history: runs the tape-out scan from
// the factory's first block to the latest finalized block and saves it
// (docs/decisions/2026-11-20-circuit-index.md, decision 2). Read only on chain.
// Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL (.env).
//
//   pnpm --filter @foreman/index scan
//
// It refuses an index that already holds tape-outs: keeping it current is the follow job's work.

import { FACTORY_FIRST_BLOCK, scanTapeOuts } from "@foreman/originality";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { migrate, readIndex, saveScan } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const existing = await readIndex(pool);
	if (existing.upToBlock !== null) {
		throw new Error(
			`the index already holds ${existing.tapeOuts.length} tape-outs up to block ${existing.upToBlock}`,
		);
	}

	const client = createPublicClient({
		chain: bsc,
		transport: http(RPC, { retryCount: 5, timeout: 30_000 }),
	});
	const { number: toBlock } = await client.getBlock({ blockTag: "finalized" });
	console.log(
		`scanning blocks ${FACTORY_FIRST_BLOCK} to ${toBlock} (latest finalized)`,
	);

	const started = Date.now();
	let last = 0;
	const scan = await scanTapeOuts(
		client,
		{ fromBlock: FACTORY_FIRST_BLOCK, toBlock },
		(stage) => {
			if (Date.now() - last < 15_000) return;
			last = Date.now();
			console.log(`${Math.round((Date.now() - started) / 1000)} s: ${stage}`);
		},
	);

	if (!scan.complete) {
		console.error(
			`scan stopped, nothing saved (${scan.reason}): ${scan.detail}`,
		);
		process.exitCode = 1;
	} else {
		for (const d of scan.dropped) {
			console.log(
				`dropped: TapedOut from unlisted contract ${d.address}, id ${d.id}, block ${d.tapedOutAt.block}`,
			);
		}
		await saveScan(pool, scan);
		const withCircuits = scan.processors.filter((p) => p.issued > 0n).length;
		console.log(
			`saved ${scan.tapeOuts.length} tape-outs on ${withCircuits} of ${scan.processors.length} processors, up to block ${scan.upToBlock}; ${scan.dropped.length} dropped; ${Math.round((Date.now() - started) / 60_000)} min`,
		);
	}
} finally {
	await pool.end();
}
