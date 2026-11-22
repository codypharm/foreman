// One circuit's result page, as GET /circuit/:processor/:tokenId will send it
// (docs/data-contract.md, CircuitPage), printed as the wire JSON. Read only. Needs
// BNB_ARCHIVE_RPC_URL and DATABASE_URL; X Layer mainnet is read from its public node.
//
//   pnpm --filter @foreman/api circuit-page <processor> <tokenId>

import { bnbClient } from "@foreman/chain-bnb";
import { serialiseApiError, serialiseCircuitPage } from "@foreman/contract";
import pg from "pg";
import { createPublicClient, http, isAddress } from "viem";
import { xLayer } from "viem/chains";
import { readCircuitPage } from "../src/page/circuit-page.ts";
import { RESULTS_CONTRACTS, XLAYER_RPC } from "../src/publish/contracts.ts";
import { loadResultContext } from "../src/result.ts";

const [processor, tokenId] = process.argv.slice(2);
if (!processor || !isAddress(processor) || !tokenId || !/^\d+$/.test(tokenId)) {
	throw new Error("usage: circuit-page <processor address> <token id>");
}
const RPC = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
const testnet = RESULTS_CONTRACTS[1952];
if (!testnet) throw new Error("No results contract on the testnet");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const bnb = bnbClient({
		archive: RPC,
		recent: process.env.BNB_RECENT_RPC_URL,
		archiveLogBlocks: process.env.BNB_ARCHIVE_LOG_BLOCKS,
		batch: false,
	});
	const xlayer = createPublicClient({
		chain: xLayer,
		transport: http(XLAYER_RPC[196], { retryCount: 5, timeout: 30_000 }),
	});
	const started = Date.now();
	const read = await readCircuitPage(
		{
			pool,
			bnb,
			xlayer,
			results: { chainId: 1952, address: testnet },
			resultContext: () => loadResultContext(pool, bnb),
		},
		{
			processor: processor.toLowerCase() as `0x${string}`,
			id: BigInt(tokenId),
		},
	);
	console.log(
		JSON.stringify(
			read.ok
				? serialiseCircuitPage(read.page, "page")
				: serialiseApiError(read.error, "error"),
			null,
			2,
		),
	);
	console.error(`${Date.now() - started} ms`);
	if (!read.ok) process.exitCode = 1;
} finally {
	await pool.end();
}
