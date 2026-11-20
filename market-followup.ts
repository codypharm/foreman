// Follow-up to market-demand.ts: who the top miner buyers are, and what happens to withdrawn listings.
// Read only. No key, no transactions. Same window and decoding as market-demand.ts (its Listed /
// PriceChanged / Sold layouts passed its decoding check); the withdrawal event is still the
// unconfirmed topic 0xd42ab404… taken to be Delisted.
//
//   node --env-file=.env scripts/market-followup.ts      # last 7 days
//
// Prints a summary and writes data/market-followup-<date>.json.

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

const ARCHIVE = process.env.BNB_ARCHIVE_RPC_URL;
if (!ARCHIVE) throw new Error("Set BNB_ARCHIVE_RPC_URL in .env; public nodes drop old events without an error");
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const CHUNK = 5000;
const WORKERS = 3;
const TOPIC = {
	listed: "0x723f73331eaee88eec7fc68ef60ab6ed15e4b90d0472b55eb92fa43910bab6dd",
	sold: "0x2938a0a3a4a7c19c3a1fe6ef25340b7acd26dfac11de87836084d42fccc18656",
	priceChanged: "0x8aa4fa52648a6d15edce8a179c792c86f3719d0cc3c572cf90f91948f0f2cb68",
};
const KNOWN_SALE = { block: 134_476_085, tx: "0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c" };
const days = Number(process.argv[2] ?? 7);

async function rpc(method: string, params: unknown[]): Promise<any> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < 8; attempt++) {
		try {
			const res = await fetch(ARCHIVE!, {
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
const fields = (log: any): string[] => [...log.topics.slice(1), ...words(log.data)];

// ---------- window and events (as market-demand.ts) ----------
const head = Number.parseInt(await rpc("eth_blockNumber", []), 16);
const headTime = Number.parseInt((await rpc("eth_getBlockByNumber", [hexBlock(head), false])).timestamp, 16);
const probe = head - 200_000;
const probeTime = Number.parseInt((await rpc("eth_getBlockByNumber", [hexBlock(probe), false])).timestamp, 16);
const secPerBlock = (headTime - probeTime) / (head - probe);
const start = Math.max(1, head - Math.round((days * 86_400) / secPerBlock));
console.log(`Head ${head}; scanning ${days} days from block ${start}`);

const chunks: number[] = [];
for (let b = start; b <= head; b += CHUNK) chunks.push(b);
const logs: any[] = [];
await Promise.all(
	Array.from({ length: WORKERS }, async () => {
		while (chunks.length) {
			const from = chunks.shift()!;
			logs.push(
				...(await rpc("eth_getLogs", [
					{ address: CIRCUIT_MARKET, fromBlock: hexBlock(from), toBlock: hexBlock(Math.min(from + CHUNK - 1, head)) },
				])),
			);
		}
	}),
);
logs.sort(
	(a, b) =>
		Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16) ||
		Number.parseInt(a.logIndex, 16) - Number.parseInt(b.logIndex, 16),
);
if (start <= KNOWN_SALE.block && !logs.some((l) => l.transactionHash === KNOWN_SALE.tx)) {
	throw new Error("Known sale not returned: this node is missing history, so every number would be too low");
}
console.log(`Read ${logs.length} market events`);

type Listing = {
	id: bigint;
	seller?: string;
	item?: string; // processor:tokenId
	processor?: string;
	tokenId?: bigint;
	listedBlock?: number;
	firstAsk?: bigint;
	ask?: bigint;
	soldBlock?: number;
	soldPrice?: bigint;
	buyer?: string;
	withdrawnBlock?: number;
	askAtWithdrawal?: bigint;
};
const listings = new Map<bigint, Listing>();
const get = (id: bigint) => {
	let l = listings.get(id);
	if (!l) listings.set(id, (l = { id }));
	return l;
};
for (const log of logs) {
	const t0 = log.topics[0];
	const f = fields(log);
	const block = Number.parseInt(log.blockNumber, 16);
	if (t0 === TOPIC.listed) {
		const l = get(toBig(f[0]));
		l.seller = toAddr(f[1]);
		l.processor = toAddr(f[2]);
		l.tokenId = toBig(f[3]);
		l.item = `${l.processor}:${l.tokenId}`;
		l.firstAsk = l.ask = toBig(f[4]);
		l.listedBlock = block;
	} else if (t0 === TOPIC.priceChanged) {
		get(toBig(f[0])).ask = toBig(f[1]);
	} else if (t0 === TOPIC.sold) {
		const l = get(toBig(f[0]));
		l.buyer = toAddr(f[1]);
		l.processor ??= toAddr(f[2]);
		l.tokenId ??= toBig(f[3]);
		l.item ??= `${l.processor}:${l.tokenId}`;
		l.soldPrice = toBig(f[4]) + toBig(f[5]);
		l.soldBlock = block;
	} else {
		// Same rule as market-demand.ts: an unknown event naming a known, unsold listing is a withdrawal.
		const id = f[0] ? toBig(f[0]) : undefined;
		const l = id !== undefined ? listings.get(id) : undefined;
		if (l && l.soldBlock === undefined) {
			l.withdrawnBlock = block;
			l.askAtWithdrawal = l.ask;
		}
	}
}

// ---------- which items are active miners now, and their weight ----------
const client = createPublicClient({ transport: http(ARCHIVE, { retryCount: 5 }) });
const items = new Map<string, { processor: string; tokenId: bigint }>();
for (const l of listings.values()) if (l.item) items.set(l.item, { processor: l.processor!, tokenId: l.tokenId! });
const minerInfo = new Map<string, { active: boolean; weight: bigint }>();
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
			args: [keccak256(encodePacked(["address", "uint256"], [it.processor as `0x${string}`, it.tokenId]))],
		})),
	});
	batch.forEach(([k], j) => {
		const r: any = results[j];
		if (r.status !== "success" || r.result.circuits === "0x0000000000000000000000000000000000000000") {
			minerInfo.set(k, { active: false, weight: 0n });
			return;
		}
		const m = r.result;
		const weight = BigInt(m.taskId) === 0n ? BigInt(m.unverWeight) : BigInt(m.verifWeight);
		minerInfo.set(k, { active: Number(m.status) === 1, weight });
	});
}
const isMiner = (l: Listing) => !!l.item && minerInfo.get(l.item)?.active === true;

// ---------- helpers ----------
const BNB = (wei: bigint) => Number(wei) / 1e18;
const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
const r = (x: number | null, d = 3) => (x === null ? "n/a" : x.toFixed(d));
const minutes = (fromBlock: number, toBlock: number) => ((toBlock - fromBlock) * secPerBlock) / 60;
const perWeight = (l: Listing) => {
	const w = minerInfo.get(l.item!)?.weight ?? 0n;
	return w > 0n ? BNB(l.soldPrice!) / Number(w) : null;
};
const all = [...listings.values()];
const minerSales = all.filter((l) => l.soldBlock !== undefined && isMiner(l));
const marketMedianPerWeight = median(minerSales.map(perWeight).filter((x): x is number => x !== null))!;

// ---------- 1. top buyers ----------
const byBuyer = new Map<string, Listing[]>();
for (const s of minerSales) byBuyer.set(s.buyer!, [...(byBuyer.get(s.buyer!) ?? []), s]);
const top = [...byBuyer.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);

console.log(`\n${"=".repeat(70)}\nTop miner buyers, last ${days} days (read at block ${head})`);
console.log(`${minerSales.length} miner sales; market median ${r(marketMedianPerWeight, 4)} BNB per weight`);
const buyers = [];
for (const [addr, bought] of top) {
	const code: string = await rpc("eth_getCode", [addr, "latest"]);
	const kind =
		code === "0x" ? "normal wallet (no code)"
		: code.startsWith("0xef0100") ? `normal wallet with EIP-7702 delegation to 0x${code.slice(8, 48)}`
		: `contract (${(code.length - 2) / 2} bytes of code)`;
	const pw = bought.map(perWeight).filter((x): x is number => x !== null);
	const below = pw.filter((x) => x < marketMedianPerWeight).length;
	const delays = bought.filter((l) => l.listedBlock !== undefined).map((l) => minutes(l.listedBlock!, l.soldBlock!));
	const sameBlock = bought.filter((l) => l.listedBlock !== undefined && l.listedBlock === l.soldBlock).length;
	// Resale: the same miner listed again by this buyer after the purchase.
	const resales = bought
		.map((b) => {
			const relist = all
				.filter((l) => l.item === b.item && l.seller === addr && l.listedBlock !== undefined && l.listedBlock > b.soldBlock!)
				.sort((x, y) => x.listedBlock! - y.listedBlock!)[0];
			return relist ? { bought: b, relist } : null;
		})
		.filter((x) => x !== null);
	const markups = resales.map(({ bought, relist }) => Number(relist.firstAsk!) / Number(bought.soldPrice!) - 1);
	const resold = resales.filter(({ relist }) => relist.soldBlock !== undefined).length;
	const out = {
		address: addr,
		kind,
		minersBought: bought.length,
		shareOfMinerSales: bought.length / minerSales.length,
		bnbSpent: bought.reduce((a, l) => a + BNB(l.soldPrice!), 0),
		medianBnbPerWeight: median(pw),
		belowMarketMedian: below,
		withPriceKnown: pw.length,
		medianMinutesListingToBuy: median(delays),
		boughtInSameBlockAsListed: sameBlock,
		withListingTimeKnown: delays.length,
		relistedInWindow: resales.length,
		medianMarkupOnRelist: median(markups),
		relistsThatSold: resold,
	};
	buyers.push(out);
	console.log(`\n${addr} (${kind})`);
	console.log(`  bought ${out.minersBought} miners (${pct(out.minersBought, minerSales.length)} of miner sales), ${r(out.bnbSpent)} BNB`);
	console.log(
		`  median ${r(out.medianBnbPerWeight, 4)} BNB per weight vs market ${r(marketMedianPerWeight, 4)}; ${below} of ${pw.length} (${pct(below, pw.length)}) below the market median`,
	);
	console.log(
		`  median ${r(out.medianMinutesListingToBuy, 1)} min from listing to purchase (${delays.length} with a known listing time; ${sameBlock} in the same block as the listing)`,
	);
	console.log(
		`  relisted ${resales.length} of ${bought.length} in the window, median markup ${out.medianMarkupOnRelist === null ? "n/a" : `${(out.medianMarkupOnRelist * 100).toFixed(0)}%`} on the first relist ask; ${resold} of those sold`,
	);
}

// ---------- 2. withdrawn miner listings ----------
const withdrawn = all.filter((l) => l.listedBlock !== undefined && l.withdrawnBlock !== undefined && isMiner(l));
const rows = withdrawn.map((w) => {
	const relists = all
		.filter((l) => l.item === w.item && l.seller === w.seller && l.listedBlock !== undefined && l.listedBlock > w.withdrawnBlock!)
		.sort((x, y) => x.listedBlock! - y.listedBlock!);
	const next = relists[0];
	const original = w.askAtWithdrawal ?? w.firstAsk!;
	return {
		listingId: w.id,
		item: w.item,
		relisted: !!next,
		change: next ? Number(next.firstAsk!) / Number(original) - 1 : null,
		firstRelistSold: next ? next.soldBlock !== undefined : false,
		anyLaterRelistSold: relists.some((l) => l.soldBlock !== undefined),
		minutesToRelist: next ? minutes(w.withdrawnBlock!, next.listedBlock!) : null,
	};
});
const relisted = rows.filter((x) => x.relisted);
const changes = relisted.map((x) => x.change!);
const higher = changes.filter((c) => c > 0.0005).length;
const lower = changes.filter((c) => c < -0.0005).length;
const same = changes.length - higher - lower;
const sold = relisted.filter((x) => x.anyLaterRelistSold).length;
const withdrawals = {
	withdrawnMinerListings: rows.length,
	relistedBySameSeller: relisted.length,
	neverRelisted: rows.length - relisted.length,
	relistHigher: higher,
	relistLower: lower,
	relistSame: same,
	medianChange: median(changes),
	medianChangeWhenLower: median(changes.filter((c) => c < -0.0005)),
	medianMinutesToRelist: median(relisted.map((x) => x.minutesToRelist!)),
	firstRelistSold: relisted.filter((x) => x.firstRelistSold).length,
	anyRelistSold: sold,
	sameMinerWithdrawnMoreThanOnce: rows.length - new Set(rows.map((x) => x.item)).size,
};
console.log(`\n${"=".repeat(70)}\nWithdrawn miner listings (created and withdrawn in the window)`);
console.log(`${rows.length} withdrawn; ${relisted.length} (${pct(relisted.length, rows.length)}) relisted by the same seller for the same miner; ${withdrawals.neverRelisted} (${pct(withdrawals.neverRelisted, rows.length)}) never relisted`);
console.log(
	`  relist vs ask at withdrawal: ${higher} higher, ${lower} lower, ${same} same; median change ${withdrawals.medianChange === null ? "n/a" : `${(withdrawals.medianChange * 100).toFixed(1)}%`} (median when lower ${withdrawals.medianChangeWhenLower === null ? "n/a" : `${(withdrawals.medianChangeWhenLower * 100).toFixed(1)}%`})`,
);
console.log(`  median ${r(withdrawals.medianMinutesToRelist, 1)} min from withdrawal to relist`);
console.log(`  relisted then sold: ${sold} of ${relisted.length} (first relist sold: ${withdrawals.firstRelistSold})`);
console.log(`  the same miner appears ${withdrawals.sameMinerWithdrawnMoreThanOnce} extra times among the withdrawals (withdrawn more than once)`);

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const file = new URL(`../data/market-followup-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url);
writeFileSync(
	file,
	`${JSON.stringify({ readAtBlock: head, days, secPerBlock, marketMedianPerWeight, buyers, withdrawals, withdrawnRows: rows }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), "\t")}\n`,
);
console.log(`\nWrote ${file.pathname}`);
