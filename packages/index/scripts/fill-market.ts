// The market index's first fill (docs/decisions/2026-11-20-market-index.md, decision 5): every
// market event from the market's first block to the latest finalized block, every listing read at
// that block, sales of the last 14 days with their miner's state, and every open listing's state.
// Read only on chain. Saves all of it in one transaction, or nothing; run it again after a stop.
// After it, the follow keeps the market current. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL.
//
//   pnpm --filter @foreman/index fill-market

import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { followMarket, migrate, readMarketBook } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const book = await readMarketBook(pool);
	if (book.upToBlock !== null) {
		throw new Error(
			`the market is already filled to block ${book.upToBlock}: the follow keeps it current`,
		);
	}
	const client = createPublicClient({
		chain: bsc,
		transport: http(RPC, {
			retryCount: 5,
			timeout: 60_000,
			batch: { batchSize: 50 },
		}),
	});
	const { number: toBlock } = await client.getBlock({ blockTag: "finalized" });
	const started = Date.now();
	console.log(`filling the market to block ${toBlock} (latest finalized)`);
	const r = await followMarket(pool, client, { toBlock, concurrency: 200 });
	const took = `${Math.round((Date.now() - started) / 1000)} s`;
	if (!r.followed) {
		console.error(`${took}: stopped: ${r.detail}`);
		process.exitCode = 1;
	} else {
		console.log(
			`${took}: to block ${r.toBlock}: ${r.sales} sales, ${r.listings} listings, ${r.open} open`,
		);
	}
} finally {
	await pool.end();
}
