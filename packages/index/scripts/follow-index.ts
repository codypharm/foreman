// Brings the index up to the latest finalized block: new tape-outs and their netlists, new miner
// starts and their commitments, new revokes (docs/decisions/2026-11-20-circuit-index.md,
// decision 5), then the market (docs/decisions/2026-11-20-market-index.md). Read only on chain; safe to stop and run again. The job runner calls the same
// function every 5 minutes once hosting is chosen. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL.
//
//   pnpm --filter @foreman/index follow

import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { followIndex, migrate } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const client = createPublicClient({
		chain: bsc,
		// Batched, so the market's per-listing reads go as one request per group
		transport: http(RPC, {
			retryCount: 5,
			timeout: 30_000,
			batch: { batchSize: 50 },
		}),
	});
	const { number: toBlock } = await client.getBlock({ blockTag: "finalized" });
	const started = Date.now();
	const since = () => `${Math.round((Date.now() - started) / 1000)} s`;
	console.log(`following to block ${toBlock} (latest finalized)`);
	const r = await followIndex(pool, client, {
		toBlock,
		onProgress: (s) => console.log(`${since()}: ${s}`),
	});
	if (!r.followed) {
		console.error(`follow stopped at ${r.stage}: ${r.detail}`);
		process.exitCode = 1;
	} else {
		console.log(
			`${since()}: to block ${r.toBlock}: ${r.tapeOuts} tape-outs, ${r.starts} miner starts, ${r.revokes} revokes; ` +
				`commitments read ${r.commitments.read} (failed ${r.commitments.failed.length}); ` +
				`netlists read ${r.netlists.read}, unreadable ${r.netlists.unreadable}, failed ${r.netlists.failed.length}, still unread ${r.netlists.remaining}`,
		);
		console.log(
			r.network.followed
				? `network days added: ${r.network.days}`
				: `network days not followed: ${r.network.detail}`,
		);
		console.log(
			r.market.followed
				? `market to block ${r.market.toBlock}: ${r.market.sales} sales, ${r.market.listings} listings touched, ${r.market.open} open`
				: `market not followed: ${r.market.detail}`,
		);
		if (
			r.commitments.failed.length ||
			r.netlists.failed.length ||
			!r.network.followed ||
			!r.market.followed
		)
			process.exitCode = 1;
	}
} finally {
	await pool.end();
}
