import { type ChainRead, parseHex32, serialiseOffer } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import recorded from "../fixtures/bnb-sales-132025299-134713299.json" with {
	type: "json",
};
import {
	type MarketAsk,
	type MarketMinerState,
	type MarketSale,
	sellComparables,
	ValuationInputError,
} from "./index.ts";

// The Sell comparables rule (docs/decisions/2026-11-20-sell-comparables.md).

const BNB = 10n ** 18n;
const DAY = 86_400n;
const AT: ChainRead = {
	chainId: 56,
	block: 134_713_299n,
	time: 1_795_600_000n,
};
const TX = parseHex32(
	"0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c",
	"tx",
);
const verified = (weight: bigint): MarketMinerState => ({
	mining: true,
	pool: "verified",
	weight,
});

/** A sale `daysAgo` days before AT, at `milli` thousandths of a BNB per unit of weight. */
function sale(
	milli: bigint,
	miner: MarketMinerState = verified(10n),
	daysAgo = 1n,
): MarketSale {
	const weight = miner.mining ? miner.weight : 10n;
	return {
		priceWei: (milli * weight * BNB) / 1000n,
		readAt: {
			chainId: 56,
			block: AT.block - daysAgo * 192_000n,
			time: AT.time - daysAgo * DAY,
		},
		tx: TX,
		miner,
	};
}

/** An open ask at AT, at `tenths` ten-thousandths of a BNB per unit of weight. */
function ask(
	tenths: bigint,
	miner: MarketMinerState = verified(10n),
): MarketAsk {
	const weight = miner.mining ? miner.weight : 10n;
	return { priceWei: (tenths * weight * BNB) / 10_000n, readAt: AT, miner };
}

/** Ten sales at 30 to 39 thousandths: median 34.5, so the ask ceiling is 103.5. */
const TEN_SALES = [30n, 31n, 32n, 33n, 34n, 35n, 36n, 37n, 38n, 39n].map((r) =>
	sale(r),
);

describe("Sell comparables", () => {
	test("only sales of miners that were mining count", () => {
		const { sales } = sellComparables({
			miner: verified(10n),
			sales: [sale(36n), sale(40n, { mining: false }), sale(35n)],
			asks: [],
			at: AT,
		});
		expect(sales.items.map((x) => x.price.value)).toEqual([
			360n * 10n ** 15n,
			350n * 10n ** 15n,
		]);
		expect(sales.range).toEqual({ state: "too-few", count: 2, minimum: 10 });
	});

	test("a miner compares only with sales from its own pool", () => {
		const unverified: MarketMinerState = {
			mining: true,
			pool: "unverified",
			weight: 1n,
		};
		const sales = [sale(36n), sale(20n, unverified), sale(35n)];
		const forVerified = sellComparables({
			miner: verified(10n),
			sales,
			asks: [],
			at: AT,
		}).sales;
		expect(forVerified.pool).toBe("verified");
		expect(forVerified.items).toHaveLength(2);

		const forUnverified = sellComparables({
			miner: unverified,
			sales,
			asks: [],
			at: AT,
		}).sales;
		expect(forUnverified.pool).toBe("unverified");
		expect(forUnverified.items.map((x) => x.price.value)).toEqual([
			20n * 10n ** 15n,
		]);
	});

	test("takes sales from the last 14 days, up to the block it is read at", () => {
		const { sales } = sellComparables({
			miner: verified(10n),
			sales: [sale(36n, verified(10n), 14n), sale(35n, verified(10n), 15n)],
			asks: [],
			at: AT,
		});
		expect(sales.items).toHaveLength(1);
		expect(sales.items[0]?.readAt.time).toBe(AT.time - 14n * DAY);
	});

	test("refuses a sale after the block it is read at", () => {
		const later = sale(36n);
		later.readAt = { ...later.readAt, block: AT.block + 1n, time: AT.time };
		expect(() =>
			sellComparables({
				miner: verified(10n),
				sales: [later],
				asks: [],
				at: AT,
			}),
		).toThrow(ValuationInputError);
	});

	test("from 10 sales: the middle half of their rates, times this miner's weight", () => {
		// Rates 30 to 39 thousandths of a BNB per unit of weight, out of order and at mixed
		// weights. Linear interpolation over 10: positions 2.25, 4.5 and 6.75, so 32.25, 34.5
		// and 36.75 thousandths, × weight 10.
		const rates = [35n, 31n, 39n, 30n, 37n, 33n, 38n, 32n, 36n, 34n];
		const { sales } = sellComparables({
			miner: verified(10n),
			sales: rates.map((r, i) => sale(r, verified(i % 2 ? 1n : 7n))),
			asks: [],
			at: AT,
		});
		expect(sales.range).toEqual({
			state: "shown",
			low: { currency: "BNB", value: 322_500_000_000_000_000n },
			mid: { currency: "BNB", value: 345_000_000_000_000_000n },
			high: { currency: "BNB", value: 367_500_000_000_000_000n },
		});
	});

	test("rounds the range down to whole wei", () => {
		// Ten sales of 10 wei at weight 3: a rate of 3⅓ wei per unit, so 3 wei for weight 1
		const tiny = Array.from({ length: 10 }, () => ({
			...sale(30n, verified(3n)),
			priceWei: 10n,
		}));
		const { sales } = sellComparables({
			miner: verified(1n),
			sales: tiny,
			asks: [],
			at: AT,
		});
		expect(sales.range).toMatchObject({
			low: { value: 3n },
			mid: { value: 3n },
			high: { value: 3n },
		});
	});

	test("a miner that isn't mining has nothing comparable", () => {
		const result = sellComparables({
			miner: { mining: false },
			sales: Array.from({ length: 12 }, () => sale(36n)),
			asks: [],
			at: AT,
		});
		for (const list of [result.sales, result.asks]) {
			expect(list).toMatchObject({
				pool: null,
				items: [],
				range: { state: "not-mining" },
				leftOut: 0,
			});
		}
	});

	test("leaves out asks over 3× the median sale, keeps low ones, and counts what it left out", () => {
		const { asks } = sellComparables({
			miner: verified(10n),
			sales: TEN_SALES,
			asks: [
				...Array.from({ length: 12 }, () => ask(400n)),
				ask(1_035n), // exactly 3× the median: kept
				ask(1_036n), // over: left out
				ask(50n), // a cheap ask is a competing seller: kept
				ask(400n, { mining: true, pool: "unverified", weight: 10n }),
				ask(400n, { mining: false }),
			],
			at: AT,
		});
		expect(asks.pool).toBe("verified");
		expect(asks.items).toHaveLength(14);
		expect(asks.leftOut).toBe(1);
		expect(asks.items.map((x) => x.price.value)).toContain(
			50_000_000_000_000_000n,
		);
		expect(asks.range).toEqual({
			state: "shown",
			low: { currency: "BNB", value: 400_000_000_000_000_000n },
			mid: { currency: "BNB", value: 400_000_000_000_000_000n },
			high: { currency: "BNB", value: 400_000_000_000_000_000n },
		});
	});

	test("with fewer than 10 sales lists every ask, unfiltered, with no asking range", () => {
		const { sales, asks } = sellComparables({
			miner: verified(10n),
			sales: TEN_SALES.slice(0, 4),
			asks: [...Array.from({ length: 11 }, () => ask(400n)), ask(9_000n)],
			at: AT,
		});
		expect(sales.range).toEqual({ state: "too-few", count: 4, minimum: 10 });
		expect(asks.items).toHaveLength(12);
		expect(asks.leftOut).toBe(0);
		expect(asks.range).toEqual({
			state: "too-few-sales",
			sales: 4,
			minimum: 10,
		});
	});

	test("states the rule that picked the sales and asks, in words for the screen", () => {
		const { sales, asks } = sellComparables({
			miner: { mining: true, pool: "unverified", weight: 3n },
			sales: [],
			asks: [],
			at: AT,
		});
		expect(sales.rule).toBe(
			"Mining miners in the unverified pool, sold in the last 14 days, compared by BNB per unit of weight. Range: the middle half of at least 10 sales, × this miner's weight.",
		);
		expect(asks.rule).toBe(
			"Mining miners in the unverified pool listed now and buyable, compared by BNB per unit of weight. Listings that can't be bought right now are not asks. Asks over 3× the median sale are left out. Range: the middle half of at least 10 asks, × this miner's weight.",
		);
		const none = sellComparables({
			miner: { mining: false },
			sales: [],
			asks: [],
			at: AT,
		});
		expect(none.sales.rule).toBe("Not mining: no comparable sales.");
		expect(none.asks.rule).toBe("Not mining: no comparable asks.");
	});

	test.each([
		["a range of sales and of asks", verified(10n), TEN_SALES, 12],
		["too few sales", verified(10n), TEN_SALES.slice(0, 3), 12],
		["too few asks", verified(10n), TEN_SALES, 2],
		["not mining", { mining: false } as const, TEN_SALES, 12],
	])(
		"gives a Sell offer the contract accepts: %s",
		(_name, miner, sales, n) => {
			const comparables = sellComparables({
				miner,
				sales,
				asks: Array.from({ length: n }, () => ask(400n)),
				at: AT,
			});
			expect(() =>
				serialiseOffer(
					{
						option: "sell",
						minerKey: TX,
						bid: { state: "none", checkedAt: AT.time },
						...comparables,
					},
					"offer",
				),
			).not.toThrow();
		},
	);
});

// Every sale on TapeOut's market in blocks 132,025,299 to 134,713,299, with getMiner at the block
// before each (fixtures/README.md). Expected values worked out separately in Python with exact
// fractions; the ADR's evidence comes from the same sales.
describe("Sell comparables on the recorded market", () => {
	const at: ChainRead = {
		chainId: 56,
		block: BigInt(recorded.toBlock),
		time: BigInt(recorded.toTime),
	};
	const sales: MarketSale[] = recorded.sales.map((s) => ({
		priceWei: BigInt(s.priceWei),
		readAt: { chainId: 56, block: BigInt(s.block), time: BigInt(s.time) },
		tx: parseHex32(s.tx, "tx"),
		miner:
			s.status !== 1
				? { mining: false }
				: s.taskId === 0
					? { mining: true, pool: "unverified", weight: BigInt(s.unverWeight) }
					: { mining: true, pool: "verified", weight: BigInt(s.verifWeight) },
	}));
	const bnb = (value: bigint) => ({ currency: "BNB", value });

	test.each([
		[
			1n,
			33_631_308_418_750_000n,
			35_850_000_000_000_000n,
			39_600_000_000_000_000n,
		],
		[
			10n,
			336_313_084_187_500_000n,
			358_500_000_000_000_000n,
			396_000_000_000_000_000n,
		],
		[
			1_204n,
			40_492_095_336_175_000_000n,
			43_163_400_000_000_000_000n,
			47_678_400_000_000_000_000n,
		],
	])(
		"a verified miner of weight %i gets the middle half of 140 sales",
		(weight, low, mid, high) => {
			const result = sellComparables({
				miner: verified(weight),
				sales,
				asks: [],
				at,
			});
			expect(result.sales.items).toHaveLength(140);
			expect(result.sales.range).toEqual({
				state: "shown",
				low: bnb(low),
				mid: bnb(mid),
				high: bnb(high),
			});
		},
	);

	test("an unverified miner has 5 sales: listed, with no range", () => {
		const result = sellComparables({
			miner: { mining: true, pool: "unverified", weight: 1n },
			sales,
			asks: [],
			at,
		});
		expect(result.sales.range).toEqual({
			state: "too-few",
			count: 5,
			minimum: 10,
		});
	});
});
