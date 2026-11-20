import { describe, expect, test } from "vitest";
import admin from "../fixtures/bnb-market-events-116708167-116711900.json" with {
	type: "json",
};
import fixture from "../fixtures/bnb-market-events-133721700-133776800.json" with {
	type: "json",
};
import { replayClient } from "./fixture.ts";
import { ChainReadError, readMarketEvents } from "./index.ts";

// Every log from TapeOut's circuit market in blocks 133,721,700 to 133,776,800, read in two
// 50,000-block chunks on the archive node (scripts/record-market-events-fixture.ts). Expected values were taken
// from the raw logs with Python, not by this reader.
const RANGE = { fromBlock: 133_721_700n, toBlock: 133_776_800n };

type RawLog = {
	topics: string[];
	blockNumber?: string;
	blockTimestamp?: string;
};
function withLogs(change: (log: RawLog, i: number) => RawLog) {
	let i = 0;
	return {
		...fixture,
		calls: fixture.calls.map((c) =>
			c.method === "eth_getLogs"
				? { ...c, result: (c.result as RawLog[]).map((l) => change(l, i++)) }
				: c,
		),
	};
}

describe("the market's admin events", () => {
	test("are its deployment, its two upgrades and its ownership, before its first listing", async () => {
		const events = await readMarketEvents(replayClient(admin), {
			fromBlock: 116_708_167n,
			toBlock: 116_711_900n,
		});
		expect(
			events.map((e) =>
				e.event === "upgraded"
					? [e.event, e.at.block, e.implementation]
					: [e.event, e.at.block],
			),
		).toEqual(EXPECTED_ADMIN);
	});
});

describe("market events", () => {
	test("are every listing, price change, delisting, sale and fee withdrawal, oldest first", async () => {
		const events = await readMarketEvents(replayClient(fixture), RANGE);
		const counts: Record<string, number> = {};
		for (const e of events) counts[e.event] = (counts[e.event] ?? 0) + 1;
		expect(counts).toEqual(EXPECTED_COUNTS);
		const order = events.map(
			(e) => e.at.block * 100_000n + BigInt(e.at.logIndex),
		);
		expect(order).toEqual(
			[...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
		);
		for (const example of EXPECTED_EXAMPLES) {
			expect(events).toContainEqual(example);
		}
	});

	test("come oldest first, by block then log, however the node orders them", async () => {
		// Each read's logs reversed, and the first two moved into one block
		let first: RawLog | undefined;
		const shuffled = {
			...fixture,
			calls: fixture.calls.map((c) => {
				if (c.method !== "eth_getLogs") return c;
				const logs = [...(c.result as (RawLog & { blockNumber: string })[])];
				if (!first) {
					first = logs[0];
					const second = logs[1];
					if (second && first)
						logs[1] = { ...second, blockNumber: first.blockNumber as string };
				}
				return { ...c, result: logs.reverse() };
			}),
		};
		const events = await readMarketEvents(replayClient(shuffled), RANGE);
		const order = events.map(
			(e) => e.at.block * 100_000n + BigInt(e.at.logIndex),
		);
		expect(order).toEqual(
			[...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
		);
		expect(events[0]?.at.block).toBe(events[1]?.at.block);
	});

	test("stop at an event nobody decoded, never skip it", async () => {
		const unknown = withLogs((l, i) =>
			i === 3
				? { ...l, topics: [`0x${"ab".repeat(32)}`, ...l.topics.slice(1)] }
				: l,
		);
		await expect(
			readMarketEvents(replayClient(unknown), RANGE),
		).rejects.toThrow(ChainReadError);
	});

	test("stop at a log the node returned without its block time", async () => {
		const timeless = withLogs((l, i) => {
			if (i !== 0) return l;
			const { blockTimestamp: _t, ...rest } = l;
			return rest;
		});
		await expect(
			readMarketEvents(replayClient(timeless), RANGE),
		).rejects.toThrow(ChainReadError);
	});
});

const EXPECTED_COUNTS = {
	listed: 23,
	delisted: 13,
	"price-changed": 11,
	sold: 6,
	withdrawn: 1,
};
const EXPECTED_EXAMPLES = [
	{
		event: "delisted",
		listingId: 27953n,
		at: {
			block: 133721757n,
			time: 1794739446n,
			tx: "0xcddb31a150702fa29d5b29f9016e941a0eace45f284ccbd2a250b0d67407d4c8",
			logIndex: 167,
		},
	},
	{
		event: "listed",
		listingId: 27964n,
		seller: "0x687b2dd8752c04707d29b85f334e918236a1ace3",
		processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
		tokenId: 16031n,
		priceWei: 391300000000000000n,
		at: {
			block: 133721895n,
			time: 1794739508n,
			tx: "0x001a65b12f214b47c37bcce16856c4b51e5f664c87e535dd5b7437336cc46501",
			logIndex: 366,
		},
	},
	{
		event: "sold",
		listingId: 27965n,
		buyer: "0x9f561beffd47ea8b475777ea951b04bc7b3c2eb0",
		processor: "0xc38c95899cd21522ef5db37cd6be4cb422cef58a",
		tokenId: 490n,
		priceWei: 397000000000000000n,
		feeWei: 3970000000000000n,
		at: {
			block: 133722178n,
			time: 1794739636n,
			tx: "0x77f11f24efe5f66b1f5eec205ed2157d8532b9ff3273db6a0ae34989a853f1d0",
			logIndex: 599,
		},
	},
	{
		event: "price-changed",
		listingId: 27636n,
		priceWei: 50000000000000000n,
		at: {
			block: 133740237n,
			time: 1794747767n,
			tx: "0xc3dcece8baa03ec602619e9e55afd2a86dbfb21d5bcf056fdf6a55a38e573169",
			logIndex: 279,
		},
	},
	{
		event: "withdrawn",
		at: {
			block: 133776745n,
			time: 1794764203n,
			tx: "0xbb1363cd841b4b082be43e3274b1340b295e404b575706a7f016c59bd62c9383",
			logIndex: 127,
		},
	},
];

const EXPECTED_ADMIN = [
	["upgraded", 116_708_167n, "0x437d0a6141079554bbaf0d507ac3070c06576647"],
	["ownership-transferred", 116_708_167n],
	["initialized", 116_708_167n],
	["upgraded", 116_709_020n, "0x725771c38361abef7b844729b978c775f7a83dfb"],
	["listed", 116_711_840n],
	["listed", 116_711_888n],
];
