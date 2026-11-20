// Sell comparables: completed sales and open asks of comparable miners on TapeOut's BNB market,
// and the range they give this miner (docs/decisions/2026-11-20-sell-comparables.md). Code, never
// a model. Prices are BNB wei; a rate is BNB per unit of weight, kept exact as a fraction.

import {
	type ChainRead,
	COMPARABLES_MINIMUM,
	type Comparable,
	type Comparables,
	type Hex32,
} from "@foreman/contract";
import { ValuationInputError } from "./errors.ts";

/** Sales from the last 14 days count, by block time. */
export const SALES_WINDOW_SECONDS = 14n * 86_400n;
/** An ask counts when its rate is no more than this many times the median sale rate. */
export const ASK_CEILING = 3n;

export type Pool = "verified" | "unverified";

/** A miner as the rule needs it, from getMiner: mining (status active) with its pool and weight, or not. */
export type MarketMinerState =
	| { mining: false }
	| {
			mining: true;
			pool: Pool;
			/** verifWeight in the verified pool, unverWeight in the unverified one. */
			weight: bigint;
	  };

export interface MarketSale {
	/** What the buyer paid, BNB wei. */
	priceWei: bigint;
	/** The sale's block and time. */
	readAt: ChainRead;
	tx: Hex32;
	/** The sold miner, read at the block before the sale. */
	miner: MarketMinerState;
}

/** An open listing that can be bought now: the seller holds the miner and the market may move it. */
export interface MarketAsk {
	/** The asking price, BNB wei. */
	priceWei: bigint;
	/** Where the listing was read. */
	readAt: ChainRead;
	/** The listed miner, read at the same block. */
	miner: MarketMinerState;
}

/** The market as the Sell rule reads it, all at one block: its sales and the asks that can be bought now. */
export interface SellMarket {
	at: ChainRead;
	sales: MarketSale[];
	asks: MarketAsk[];
}

export function sellComparables(input: {
	miner: MarketMinerState;
	sales: MarketSale[];
	asks: MarketAsk[];
	at: ChainRead;
}): { sales: Comparables; asks: Comparables } {
	const { at } = input;
	for (const s of input.sales) {
		if (s.readAt.block > at.block) {
			throw new ValuationInputError(
				`A sale at block ${s.readAt.block} is after the block the comparables are read at (${at.block})`,
			);
		}
	}
	if (!input.miner.mining) {
		const none = (what: string): Comparables => ({
			venue: "bnb-market",
			pool: null,
			rule: `Not mining: no comparable ${what}.`,
			items: [],
			range: { state: "not-mining" },
			leftOut: 0,
		});
		return { sales: none("sales"), asks: none("asks") };
	}
	const pool = input.miner.pool;
	const since = at.time - SALES_WINDOW_SECONDS;
	const comparable = input.sales.filter(
		(s) => s.miner.mining && s.miner.pool === pool && s.readAt.time >= since,
	);
	const salesItems: Comparable[] = comparable.map((s) => ({
		...item(s.priceWei, s.miner, s.readAt),
		tx: s.tx,
	}));
	const salesRange = rangeFor(salesItems, input.miner);

	// Asks: mining, same pool, and no more than 3× the median sale rate. Low asks stay in.
	const sameKind = input.asks.filter(
		(a) => a.miner.mining && a.miner.pool === pool,
	);
	const askItems = sameKind.map((a) => item(a.priceWei, a.miner, a.readAt));
	let keptAsks = askItems;
	if (salesRange.state === "shown") {
		const median = percentile(sortedRates(salesItems), 2n);
		const ceiling = { num: ASK_CEILING * median.num, den: median.den };
		keptAsks = askItems.filter((x) => compare(rateOf(x), ceiling) <= 0);
	}
	return {
		sales: {
			venue: "bnb-market",
			pool,
			rule: `Mining miners in the ${pool} pool, sold in the last ${SALES_WINDOW_SECONDS / 86_400n} days, compared by BNB per unit of weight. Range: the middle half of at least ${COMPARABLES_MINIMUM} sales, × this miner's weight.`,
			items: salesItems,
			range: salesRange,
			leftOut: 0,
		},
		asks: {
			venue: "bnb-market",
			pool,
			rule: `Mining miners in the ${pool} pool listed now and buyable, compared by BNB per unit of weight. Listings that can't be bought right now are not asks. Asks over ${ASK_CEILING}× the median sale are left out. Range: the middle half of at least ${COMPARABLES_MINIMUM} asks, × this miner's weight.`,
			items: keptAsks,
			range:
				salesRange.state === "shown"
					? rangeFor(keptAsks, input.miner)
					: {
							state: "too-few-sales",
							sales: salesItems.length,
							minimum: COMPARABLES_MINIMUM,
						},
			leftOut: askItems.length - keptAsks.length,
		},
	};
}

function item(
	priceWei: bigint,
	miner: MarketMinerState,
	readAt: ChainRead,
): Comparable {
	if (!miner.mining) throw new RangeError("only a mining miner is comparable");
	return {
		price: { currency: "BNB", value: priceWei },
		weight: miner.weight,
		readAt,
	};
}

/** BNB wei per unit of weight, exact. */
interface Rate {
	num: bigint;
	den: bigint;
}

function rangeFor(
	items: Comparable[],
	miner: MarketMinerState,
): Comparables["range"] {
	if (items.length < COMPARABLES_MINIMUM || !miner.mining) {
		return {
			state: "too-few",
			count: items.length,
			minimum: COMPARABLES_MINIMUM,
		};
	}
	const rates = sortedRates(items);
	const at = (quarter: bigint) => ({
		currency: "BNB" as const,
		value: times(percentile(rates, quarter), miner.weight),
	});
	return { state: "shown", low: at(1n), mid: at(2n), high: at(3n) };
}

function rateOf(x: Comparable): Rate {
	return { num: x.price.value, den: x.weight };
}

function sortedRates(items: Comparable[]): Rate[] {
	return items.map(rateOf).sort(compare);
}

function compare(a: Rate, b: Rate): number {
	const l = a.num * b.den;
	const r = b.num * a.den;
	return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * The rate at `quarter` quarters of the way through the sorted rates, by linear interpolation
 * between neighbours: position (n − 1) × quarter / 4.
 */
function percentile(sorted: Rate[], quarter: bigint): Rate {
	const position = BigInt(sorted.length - 1) * quarter;
	const k = Number(position / 4n);
	const f = position % 4n;
	const lo = sorted[k];
	if (!lo) throw new RangeError("no rates");
	const hi = sorted[k + 1];
	if (f === 0n || !hi) return lo;
	return {
		num: (4n - f) * lo.num * hi.den + f * hi.num * lo.den,
		den: 4n * lo.den * hi.den,
	};
}

/** A rate × a weight, in whole wei, rounded down. */
function times(rate: Rate, weight: bigint): bigint {
	return (rate.num * weight) / rate.den;
}
