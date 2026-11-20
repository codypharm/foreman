// Market demand check: is anyone actually buying miners on TapeOut's BNB circuit market?
// Read only. No key, no transactions. Uses Furqaan's ABIs from @foreman/chain-bnb without changing them.
//
//   node --env-file=.env scripts/market-demand.ts      # last 7 days
//   node --env-file=.env scripts/market-demand.ts 14   # last 14 days
//
// Prints a summary and writes data/market-demand-<date>.json.
//
// Event layouts: Sold is confirmed (abi.ts). Listed(uint256,address,address,uint256,uint256) and
// PriceChanged(uint256,uint256) match their topic hashes (notes/2026-11-19-xlayer-market-findings.md),
// but which parameters are indexed is assumed to follow Sold (leading parameters indexed). The script
// checks this: every sale's price should equal the last ask it saw for that listing. If the match rate
// is low it says so, and the listing numbers should not be trusted.

import { mkdirSync, writeFileSync } from "node:fs";
import {
	CIRCUIT_MARKET,
	POD_MINING,
	podMiningAbi,
} from "../packages/chain-bnb/src/abi.ts";
import {
	createPublicClient,
	encodePacked,
	http,
	keccak256,
} from "../packages/chain-bnb/node_modules/viem/_esm/index.js";

// The free public nodes silently return [] for events older than a few hours, so a node with history
// is required: BNB_ARCHIVE_RPC_URL in .env (run with `node --env-file=.env ...`).
const ARCHIVE = process.env.BNB_ARCHIVE_RPC_URL;
if (!ARCHIVE) throw new Error("Set BNB_ARCHIVE_RPC_URL in .env; public nodes drop old events without an error");
const RPCS = [ARCHIVE];
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const CHUNK = 5000;
const WORKERS = 3;

const TOPIC = {
	listed: "0x723f73331eaee88eec7fc68ef60ab6ed15e4b90d0472b55eb92fa43910bab6dd",
	sold: "0x2938a0a3a4a7c19c3a1fe6ef25340b7acd26dfac11de87836084d42fccc18656",
	priceChanged:
		"0x8aa4fa52648a6d15edce8a179c792c86f3719d0cc3c572cf90f91948f0f2cb68",
};
const STATUSES = ["not-mining", "active", "revoked", "cooling"];

const days = Number(process.argv[2] ?? 7);
if (!Number.isFinite(days) || days <= 0) throw new Error("days must be > 0");

// ---------- raw JSON-RPC with retries and node fallback ----------
let rpcIndex = 0;
async function rpc(method: string, params: unknown[]): Promise<any> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < 8; attempt++) {
		const url = RPCS[(rpcIndex + attempt) % RPCS.length];
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = await res.json();
			if (j.error) throw new Error(JSON.stringify(j.error));
			return j.result;
		} catch (e) {
			lastErr = e;
			await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
		}
	}
	throw new Error(`${method} failed after retries: ${String(lastErr)}`);
}

const hexBlock = (n: number) => `0x${n.toString(16)}`;
const words = (data: string) => data.slice(2).match(/.{64}/g) ?? [];
const toBig = (w: string) => BigInt(`0x${w.replace(/^0x/, "")}`);
const toAddr = (w: string) => `0x${w.replace(/^0x/, "").slice(-40)}`.toLowerCase();

// Indexed parameters come first in topics, the rest in data, in declared order.
function fields(log: any): string[] {
	return [...log.topics.slice(1), ...words(log.data)];
}

// ---------- 1. Window ----------
const head = Number.parseInt(await rpc("eth_blockNumber", []), 16);
const headBlock = await rpc("eth_getBlockByNumber", [hexBlock(head), false]);
const headTime = Number.parseInt(headBlock.timestamp, 16);
const probe = head - 200_000;
const probeTime = Number.parseInt(
	(await rpc("eth_getBlockByNumber", [hexBlock(probe), false])).timestamp,
	16,
);
const secPerBlock = (headTime - probeTime) / (head - probe);
const start = Math.max(1, head - Math.round((days * 86_400) / secPerBlock));
const timeOf = (block: number) => headTime - (head - block) * secPerBlock; // linear estimate
console.log(
	`Head ${head}; ${secPerBlock.toFixed(3)} s per block; scanning ${days} days from block ${start} (${head - start} blocks)`,
);

// ---------- 2. All market events in the window ----------
const chunks: number[] = [];
for (let b = start; b <= head; b += CHUNK) chunks.push(b);
const logs: any[] = [];
let done = 0;
async function worker() {
	while (chunks.length) {
		const from = chunks.shift()!;
		const to = Math.min(from + CHUNK - 1, head);
		const got = await rpc("eth_getLogs", [
			{ address: CIRCUIT_MARKET, fromBlock: hexBlock(from), toBlock: hexBlock(to) },
		]);
		logs.push(...got);
		done++;
		if (done % 500 === 0) console.log(`  ${done} chunks read, ${logs.length} events`);
	}
}
await Promise.all(Array.from({ length: WORKERS }, worker));
logs.sort(
	(a, b) =>
		Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16) ||
		Number.parseInt(a.logIndex, 16) - Number.parseInt(b.logIndex, 16),
);
console.log(`Read ${logs.length} market events`);
// Guard against a node that answers [] instead of an error: a sale known from Furqaan's fixture must be found.
const KNOWN_SALE = { block: 134_476_085, tx: "0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c" };
if (start <= KNOWN_SALE.block && KNOWN_SALE.block <= head && !logs.some((l) => l.transactionHash === KNOWN_SALE.tx)) {
	throw new Error("Known sale at block 134,476,085 not returned: this node is missing history, so every number would be too low");
}

// ---------- 3. Rebuild each listing's life ----------
type Listing = {
	id: bigint;
	seller?: string;
	processor?: string;
	tokenId?: bigint;
	listedBlock?: number;
	firstAsk?: bigint;
	ask?: bigint;
	cuts: number;
	raises: number;
	soldBlock?: number;
	soldPrice?: bigint;
	buyer?: string;
	askMatchedSale?: boolean;
	withdrawnBlock?: number;
};
const listings = new Map<bigint, Listing>();
const get = (id: bigint) => {
	let l = listings.get(id);
	if (!l) listings.set(id, (l = { id, cuts: 0, raises: 0 }));
	return l;
};
const otherTopics = new Map<string, number>();

for (const log of logs) {
	const t0 = log.topics[0];
	const f = fields(log);
	const block = Number.parseInt(log.blockNumber, 16);
	if (t0 === TOPIC.listed) {
		const l = get(toBig(f[0]));
		l.seller = toAddr(f[1]);
		l.processor = toAddr(f[2]);
		l.tokenId = toBig(f[3]);
		l.firstAsk = l.ask = toBig(f[4]);
		l.listedBlock = block;
	} else if (t0 === TOPIC.priceChanged) {
		const l = get(toBig(f[0]));
		const next = toBig(f[1]);
		if (l.ask !== undefined) {
			if (next < l.ask) l.cuts++;
			else if (next > l.ask) l.raises++;
		}
		l.ask = next;
	} else if (t0 === TOPIC.sold) {
		// Sold(id, buyer, processor, tokenId, sellerProceeds, fee)
		const l = get(toBig(f[0]));
		l.buyer = toAddr(f[1]);
		l.processor ??= toAddr(f[2]);
		l.tokenId ??= toBig(f[3]);
		l.soldPrice = toBig(f[4]) + toBig(f[5]);
		l.soldBlock = block;
		if (l.ask !== undefined) l.askMatchedSale = l.ask === l.soldPrice;
	} else {
		otherTopics.set(t0, (otherTopics.get(t0) ?? 0) + 1);
		// Probably Delisted: treat the first field as the listing id if we know that listing.
		const id = f[0] ? toBig(f[0]) : undefined;
		if (id !== undefined && listings.has(id)) {
			const l = listings.get(id)!;
			if (l.soldBlock === undefined) l.withdrawnBlock = block;
		}
	}
}

// ---------- 4. Which items are mining miners (status now) ----------
const client = createPublicClient({ transport: http(RPCS[0], { retryCount: 5 }) });
const items = new Map<string, { processor: string; tokenId: bigint }>();
for (const l of listings.values()) {
	if (l.processor && l.tokenId !== undefined) {
		items.set(`${l.processor}:${l.tokenId}`, { processor: l.processor, tokenId: l.tokenId });
	}
}
const minerInfo = new Map<string, { status: string; weight: bigint }>();
const itemList = [...items.entries()];
for (let i = 0; i < itemList.length; i += 100) {
	const batch = itemList.slice(i, i + 100);
	const results = await client.multicall({
		multicallAddress: MULTICALL3,
		allowFailure: true,
		blockNumber: BigInt(head),
		contracts: batch.map(([, it]) => ({
			address: POD_MINING,
			abi: podMiningAbi,
			functionName: "getMiner",
			args: [keccak256(encodePacked(["address", "uint256"], [it.processor, it.tokenId]))],
		})),
	});
	batch.forEach(([k], j) => {
		const r: any = results[j];
		if (r.status !== "success" || r.result.circuits === "0x0000000000000000000000000000000000000000") {
			minerInfo.set(k, { status: "not-a-miner", weight: 0n });
			return;
		}
		const m = r.result;
		const status = STATUSES[Number(m.status)] ?? `unknown-${m.status}`;
		const weight = BigInt(m.taskId) === 0n ? BigInt(m.unverWeight) : BigInt(m.verifWeight);
		minerInfo.set(k, { status, weight });
	});
}

// ---------- 5. Numbers ----------
const BNB = (wei: bigint) => Number(wei) / 1e18;
const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
const r = (x: number | null, d = 3) => (x === null ? "n/a" : x.toFixed(d));

function summarise(name: string, filter: (l: Listing, info?: { status: string; weight: bigint }) => boolean) {
	const all = [...listings.values()].filter((l) => {
		const info = l.processor ? minerInfo.get(`${l.processor}:${l.tokenId}`) : undefined;
		return filter(l, info);
	});
	const created = all.filter((l) => l.listedBlock !== undefined);
	const createdSold = created.filter((l) => l.soldBlock !== undefined);
	const createdWithdrawn = created.filter((l) => l.withdrawnBlock !== undefined);
	const createdOpen = created.length - createdSold.length - createdWithdrawn.length;
	const sales = all.filter((l) => l.soldBlock !== undefined);
	const hoursToSale = createdSold.map((l) => (timeOf(l.soldBlock!) - timeOf(l.listedBlock!)) / 3600);
	const salePrices = sales.map((l) => BNB(l.soldPrice!));
	const perWeight = sales
		.map((l) => {
			const w = minerInfo.get(`${l.processor}:${l.tokenId}`)?.weight ?? 0n;
			return w > 0n ? BNB(l.soldPrice!) / Number(w) : null;
		})
		.filter((x): x is number => x !== null);
	const buyers = new Map<string, number>();
	for (const s of sales) buyers.set(s.buyer!, (buyers.get(s.buyer!) ?? 0) + 1);
	const topBuyer = Math.max(0, ...buyers.values());
	const sellers = new Set(created.map((l) => l.seller));
	const cut = created.filter((l) => l.cuts > 0);
	const cutDepth = cut
		.filter((l) => l.firstAsk && l.ask !== undefined && l.firstAsk > 0n)
		.map((l) => 1 - Number(l.ask!) / Number(l.firstAsk!));

	const out = {
		group: name,
		listingsCreated: created.length,
		uniqueSellers: sellers.size,
		ofThoseSold: createdSold.length,
		ofThoseWithdrawn: createdWithdrawn.length,
		ofThoseStillOpen: createdOpen,
		listingsWithAPriceCut: cut.length,
		medianCutFromFirstAsk: median(cutDepth),
		sales: sales.length,
		salesPerDay: sales.length / days,
		bnbTraded: salePrices.reduce((a, b) => a + b, 0),
		medianSaleBnb: median(salePrices),
		medianSaleBnbPerWeight: median(perWeight),
		uniqueBuyers: buyers.size,
		topBuyerShareOfSales: sales.length ? topBuyer / sales.length : null,
		medianHoursListedToSold: median(hoursToSale),
	};
	console.log(`\n== ${name} ==`);
	console.log(`Listings created in window: ${created.length} by ${sellers.size} sellers`);
	console.log(
		`  sold ${createdSold.length} (${pct(createdSold.length, created.length)}), withdrawn ${createdWithdrawn.length} (${pct(createdWithdrawn.length, created.length)}), still open ${createdOpen} (${pct(createdOpen, created.length)})`,
	);
	console.log(
		`  price cut at least once: ${cut.length} (${pct(cut.length, created.length)}), median cut from first ask ${r(out.medianCutFromFirstAsk === null ? null : out.medianCutFromFirstAsk * 100, 0)}%`,
	);
	console.log(
		`Sales in window: ${sales.length} (${r(out.salesPerDay, 1)}/day), ${r(out.bnbTraded)} BNB total, median ${r(out.medianSaleBnb)} BNB, median ${r(out.medianSaleBnbPerWeight, 4)} BNB per weight`,
	);
	console.log(
		`  ${buyers.size} distinct buyers; the top buyer made ${pct(topBuyer, sales.length)} of purchases`,
	);
	console.log(`  median time from listing to sale: ${r(out.medianHoursListedToSold, 1)} h (listings created in window only)`);
	return out;
}

console.log(`\n${"=".repeat(70)}\nTapeOut circuit market, last ${days} days (BNB Chain, read at block ${head})`);
const statusCounts: Record<string, number> = {};
for (const v of minerInfo.values()) statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
console.log(`Items seen: ${minerInfo.size}; status now: ${JSON.stringify(statusCounts)}`);

const groups = [
	summarise("Mining miners (active now)", (_l, i) => i?.status === "active"),
	summarise("Everything on the market", () => true),
];

// Decoding check: a sale's price should equal the last ask we saw for that listing.
const checked = [...listings.values()].filter((l) => l.askMatchedSale !== undefined);
const matched = checked.filter((l) => l.askMatchedSale).length;
console.log(
	`\nDecoding check: ${matched} of ${checked.length} sales matched their last ask (${pct(matched, checked.length)}). ${checked.length && matched / checked.length < 0.9 ? "LOW: listing numbers may be decoded wrongly; paste this output to Claude." : "OK."}`,
);
console.log(`Other event types (probably Delisted): ${JSON.stringify(Object.fromEntries(otherTopics))}`);

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const file = new URL(`../data/market-demand-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url);
writeFileSync(
	file,
	`${JSON.stringify({ readAtBlock: head, days, secPerBlock, decodingCheck: { matched, checked }, otherTopics: Object.fromEntries(otherTopics), groups }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), "\t")}\n`,
);
console.log(`\nWrote ${file.pathname}. Paste everything above back into the chat.`);
