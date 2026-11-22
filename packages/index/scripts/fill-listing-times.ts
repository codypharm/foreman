// The one-off fill of listing times (migration 009): every listing the market index held before
// the follow started keeping when each was listed gets its Listed event's block and time. Read
// only on chain; saves every listing's time or none. Run it once after migration 009; the follow
// keeps new listings' times. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL.
//
//   pnpm --filter @foreman/index fill-listing-times

import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { fillListingTimes, migrate } from "../src/index.ts";

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
		transport: http(RPC, { retryCount: 5, timeout: 60_000 }),
	});
	const started = Date.now();
	const r = await fillListingTimes(pool, client);
	const took = `${Math.round((Date.now() - started) / 1000)} s`;
	if (!r.filled) {
		console.error(`${took}: stopped: ${r.detail}`);
		process.exitCode = 1;
	} else {
		console.log(`${took}: ${r.listings} listings have their listing time`);
	}
} finally {
	await pool.end();
}
