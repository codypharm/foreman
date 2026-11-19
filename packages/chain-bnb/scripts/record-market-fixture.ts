// Records the responses the market tests replay. Read only.
//
//   pnpm --filter @foreman/chain-bnb record:market

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readActiveListings, readListing, readSales } from "../src/index.ts";

const RPC = "https://bsc-rpc.publicnode.com";
const BLOCK = 134_486_640n;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const id of [28_081n, 28_083n]) {
	await readListing(client, id, { blockNumber: BLOCK });
}
await readActiveListings(client, { blockNumber: BLOCK, latest: 20 });
const sales = await readSales(client, {
	fromBlock: 134_476_000n,
	toBlock: 134_483_100n,
});
console.log(`recorded 2 listings and ${sales.length} sales`);

const out = new URL(`../fixtures/bnb-market-${BLOCK}.json`, import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(BLOCK), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${calls.length} calls → ${out.pathname}`);
