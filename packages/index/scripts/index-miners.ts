// Adds every miner to the index: scans the mining contract's Started events from its creation
// to the index's block, saves them, then reads each miner's design commitment at that block
// (docs/decisions/2026-11-20-circuit-index.md, decision 4). Read only on chain. The commitment
// step is safe to stop and run again. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL (.env).
//
//   pnpm --filter @foreman/index miners [--concurrency N]
//
// About 350 log reads, then one getMiner call per miner (about 21,000).

import { parseArgs } from "node:util";
import { MINING_FIRST_BLOCK, scanMinerStarts } from "@foreman/originality";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import {
	backfillCommitments,
	migrate,
	readMiners,
	saveMinerStarts,
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

	const state = await pool.query<{ up_to_block: string }>(
		"select up_to_block from index_state",
	);
	const indexBlock = state.rows[0]?.up_to_block;
	if (!indexBlock)
		throw new Error("the index is empty: run the tape-out scan first");
	const { upToBlock } = await readMiners(pool);
	if (upToBlock === null) {
		const toBlock = BigInt(indexBlock);
		console.log(
			`scanning miner starts, blocks ${MINING_FIRST_BLOCK} to ${toBlock}`,
		);
		const scan = await scanMinerStarts(
			client,
			{ fromBlock: MINING_FIRST_BLOCK, toBlock },
			(s) => every15s(() => s),
		);
		if (!scan.complete) {
			console.error(`miner scan stopped, nothing saved: ${scan.detail}`);
			process.exitCode = 1;
			throw new Error("miner scan stopped");
		}
		await saveMinerStarts(pool, scan);
		const miners = new Set(scan.starts.map((s) => s.key)).size;
		console.log(
			`${since()}: saved ${scan.starts.length} starts by ${miners} miners`,
		);
	} else {
		console.log(
			`miner starts already saved up to block ${upToBlock}; reading commitments only`,
		);
	}

	const result = await backfillCommitments(pool, client, {
		concurrency: Number(values.concurrency),
		onProgress: (done, total) =>
			every15s(() => `${done} of ${total} commitments`),
	});
	for (const f of result.failed)
		console.log(`read failed, will retry: ${f.key}: ${f.detail}`);
	console.log(
		`commitments read ${result.read} (${result.withCommitment} with one), failed ${result.failed.length}, still unread ${result.remaining}; at block ${result.atBlock}; ${since()}`,
	);
	if (result.failed.length) process.exitCode = 1;
} finally {
	await pool.end();
}
