// Records the result page's fixture (fixtures/circuit-page.json): every BNB Chain and X Layer call
// the page makes for PAGE_CIRCUITS, at a recent BNB block that a public node still serves (no
// archive node needed), and X Layer's latest block. The network days come from the local index.
// Read only. Needs TEST_DATABASE_URL (the page's test database) and DATABASE_URL (the local index).
//
//   pnpm --filter @foreman/api record:page

import { writeFileSync } from "node:fs";
import {
	type RpcCall,
	recordingClient,
	replayClient,
} from "@foreman/chain-bnb/fixture";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import pg from "pg";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { readCircuitPage } from "../src/page/circuit-page.ts";
import {
	type NetworkDay,
	PAGE_CIRCUITS,
	pageIndex,
} from "../src/page/page-fixture.ts";
import { RESULTS_CONTRACTS, XLAYER_RPC } from "../src/publish/contracts.ts";
import { loadResultContext } from "../src/result.ts";

const BNB_PUBLIC = "https://bsc-dataseed.bnbchain.org";
const DAY = 86_400n;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
if (!process.env.TEST_DATABASE_URL)
	throw new Error("TEST_DATABASE_URL is not set");
const testnet = RESULTS_CONTRACTS[1952];
if (!testnet) throw new Error("No results contract on the testnet");

// A few blocks behind the head, so every call lands while the public node still holds that state
const head = await createPublicClient({
	chain: bsc,
	transport: http(BNB_PUBLIC),
}).getBlock();
const bnbCalls: RpcCall[] = [];
const xlayerCalls: RpcCall[] = [];
const bnb = recordingClient(BNB_PUBLIC, bnbCalls);
const xlayer = recordingClient(XLAYER_RPC[196], xlayerCalls);
const market = { block: head.number - 3n, time: 0n };
market.time = (await bnb.getBlock({ blockNumber: market.block })).timestamp;

const local = new pg.Pool({ connectionString: DATABASE_URL });
const lastMidnight = market.time - (market.time % DAY);
const { rows: networkDays } = await local.query<NetworkDay>(
	`select day::text, block::text, time::text, verified_weight::text as "verifiedWeight",
	   unverified_weight::text as "unverifiedWeight", miner_count::text as "minerCount",
	   verified_miner_count::text as "verifiedMinerCount"
	 from network_days where day between $1 and $2 order by day`,
	[(lastMidnight - 31n * DAY).toString(), lastMidnight.toString()],
);
await local.end();

const pool = await pageIndex({ bnb, market, networkDays });
try {
	for (const [name, circuit] of Object.entries(PAGE_CIRCUITS)) {
		const read = await readCircuitPage(
			{
				pool,
				bnb,
				xlayer,
				results: { chainId: 1952, address: testnet },
				resultContext: () => loadResultContext(pool, replayClient(circuits)),
			},
			circuit,
		);
		console.log(
			`${name}: ${read.ok ? "page" : `${read.error.error}: ${read.error.detail}`}`,
		);
		if (!read.ok) throw new Error(`The ${name} page didn't build`);
	}
} finally {
	await pool.end();
}

const at = new Date().toISOString();
const fixture = {
	recordedAt: at,
	market: { block: market.block.toString(), time: market.time.toString() },
	networkDays,
	bnb: {
		chainId: 56,
		block: market.block.toString(),
		recordedAt: at,
		calls: bnbCalls,
	},
	xlayer: { chainId: 196, block: "latest", recordedAt: at, calls: xlayerCalls },
};
writeFileSync(
	new URL("../fixtures/circuit-page.json", import.meta.url),
	`${JSON.stringify(fixture, null, "\t")}\n`,
);
console.log(
	`BNB block ${market.block}: ${bnbCalls.length} BNB calls, ${xlayerCalls.length} X Layer calls`,
);
