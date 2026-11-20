// Adds every revoked miner to the index: scans the mining contract's Revoked events from its
// creation to the block the miner starts are read up to, and saves them in one transaction
// (docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md, decision 1). Read only on chain.
// Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL (.env).
//
//   pnpm --filter @foreman/index revokes
//
// About 350 log reads.

import { MINING_FIRST_BLOCK, scanMinerRevokes } from "@foreman/originality";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { migrate, readMiners, saveMinerRevokes } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const { upToBlock, revokesUpToBlock } = await readMiners(pool);
	if (upToBlock === null)
		throw new Error("miners are not indexed: run the miner scan first");
	if (revokesUpToBlock !== null)
		throw new Error(
			`revokes are already read up to block ${revokesUpToBlock}; the follow job keeps them current`,
		);
	const client = createPublicClient({
		chain: bsc,
		transport: http(RPC, { retryCount: 5, timeout: 30_000 }),
	});
	const started = Date.now();
	const since = () => `${Math.round((Date.now() - started) / 1000)} s`;
	let last = 0;
	console.log(`scanning revokes, blocks ${MINING_FIRST_BLOCK} to ${upToBlock}`);
	const scan = await scanMinerRevokes(
		client,
		{ fromBlock: MINING_FIRST_BLOCK, toBlock: upToBlock },
		(s) => {
			if (Date.now() - last < 15_000) return;
			last = Date.now();
			console.log(`${since()}: ${s}`);
		},
	);
	if (!scan.complete) {
		console.error(`revoke scan stopped, nothing saved: ${scan.detail}`);
		process.exitCode = 1;
	} else {
		await saveMinerRevokes(pool, scan);
		console.log(`${since()}: saved ${scan.revokes.length} revoked miners`);
	}
} finally {
	await pool.end();
}
