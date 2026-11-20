// Records one market scan for the scan's tests: blocks 134,650,000 to 134,713,299, starting from
// 40 listings open at block 134,713,299 (fixtures/market-scan-open-listings.json; two of them can't
// be bought). Read only. Needs the archive node.
//
//   pnpm --filter @foreman/chain-bnb record:market-scan

import { readFileSync, writeFileSync } from "node:fs";
import { parseAddress } from "@foreman/contract";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readMarketEvents, scanMarket } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
const RANGE = { fromBlock: 134_650_000n, toBlock: 134_713_299n };
const ISSUED_AT_END = 28_111n; // nextListingId at block 134,713,299 (CLAUDE.md, "On-chain facts")

const open = (
	JSON.parse(
		readFileSync(
			new URL("../fixtures/market-scan-open-listings.json", import.meta.url),
			"utf8",
		),
	) as {
		listingId: string;
		seller: string;
		processor: string;
		tokenId: string;
		priceWei: string;
	}[]
).map((l) => ({
	listingId: BigInt(l.listingId),
	seller: parseAddress(l.seller, "seller"),
	processor: parseAddress(l.processor, "processor"),
	tokenId: BigInt(l.tokenId),
	priceWei: BigInt(l.priceWei),
	feeBps: 100,
}));

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const listed = (await readMarketEvents(client, RANGE)).filter(
	(e) => e.event === "listed",
).length;
const scan = await scanMarket(client, {
	...RANGE,
	listingsIndexed: ISSUED_AT_END - BigInt(listed),
	open,
	stateWindowSeconds: 14n * 86_400n,
	concurrency: 10,
});
if (!scan.complete) throw new Error(scan.detail);
console.log(
	`recorded ${scan.sales.length} sales, ${scan.listings.length} touched listings, ${scan.states.length} open listing states (${scan.states.filter((s) => !s.buyable).length} not buyable); ${listed} Listed events`,
);

const out = new URL(
	`../fixtures/bnb-market-scan-${RANGE.fromBlock}-${RANGE.toBlock}.json`,
	import.meta.url,
);
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(RANGE.toBlock), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
