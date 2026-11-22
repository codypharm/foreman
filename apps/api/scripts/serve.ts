// The API on this machine (docs/decisions/2026-11-21-api-endpoints.md): GET /circuit/:processor/:tokenId
// for now. Read only. Needs BNB_ARCHIVE_RPC_URL and DATABASE_URL; BNB_RECENT_RPC_URL is optional
// (docs/decisions/2026-11-21-bnb-nodes.md). X Layer mainnet is read from its public node.
//
//   pnpm --filter @foreman/api serve        (PORT, default 8787)

import { bnbClient } from "@foreman/chain-bnb";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import { RESULTS_CONTRACTS, XLAYER_RPC } from "../src/publish/contracts.ts";
import { createApp } from "../src/server/app.ts";
import { cachedResultContext } from "../src/server/result-context.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
const testnet = RESULTS_CONTRACTS[1952];
if (!testnet) throw new Error("No results contract on the testnet");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const bnb = bnbClient({
	archive: RPC,
	recent: process.env.BNB_RECENT_RPC_URL,
	archiveLogBlocks: process.env.BNB_ARCHIVE_LOG_BLOCKS,
	batch: true,
});
const xlayer = createPublicClient({
	chain: xLayer,
	transport: http(XLAYER_RPC[196], { retryCount: 5, timeout: 30_000 }),
});
const app = createApp({
	pool,
	bnb,
	xlayer,
	results: { chainId: 1952, address: testnet },
	resultContext: cachedResultContext(pool, bnb),
});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
	console.log(`Foreman API on http://localhost:${port}`);
});
