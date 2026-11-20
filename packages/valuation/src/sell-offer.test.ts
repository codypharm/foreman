import {
	type Miner,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import { describe, expect, test } from "vitest";
import {
	type MarketSale,
	type SellMarket,
	sellComparables,
	sellOffer,
	ValuationInputError,
} from "./index.ts";

// The Sell offer for one miner, from the market as the index holds it
// (docs/decisions/2026-11-20-sell-comparables.md, 2026-11-19-sell-without-bids.md).

const BNB = 10n ** 18n;
const AT = {
	chainId: 56 as const,
	block: 134_724_711n,
	time: 1_795_190_973n,
};
const KEY = parseHex32(`0x${"ab".repeat(32)}`, "key");
const TX = parseHex32(`0x${"cd".repeat(32)}`, "tx");

const MINER: Miner = {
	key: KEY,
	processor: parseAddress("0xb1024b89886b9a34aa4ff5f31c411d708b20a14c", "p"),
	tokenId: 7n,
	owner: parseAddress(`0x${"12".repeat(20)}`, "owner"),
	status: "active",
	pool: "verified",
	taskId: 4,
	weight: 10n,
	weightWithoutBonus: 10n,
	holdsBonus: false,
	miningSince: 1_795_000_000n,
	readAt: AT,
};

/** A sale an hour before AT, at `milli` thousandths of a BNB per unit of weight, weight 10. */
const sale = (milli: bigint): MarketSale => ({
	priceWei: milli * 10n ** 16n,
	readAt: { chainId: 56, block: AT.block - 4_800n, time: AT.time - 3_600n },
	tx: TX,
	miner: { mining: true, pool: "verified", weight: 10n },
});

const MARKET: SellMarket = {
	at: AT,
	sales: [30n, 31n, 32n, 33n, 34n, 35n, 36n, 37n, 38n, 39n].map(sale),
	asks: [
		{
			priceWei: 4n * BNB,
			readAt: AT,
			miner: { mining: true, pool: "verified", weight: 10n },
		},
	],
};

describe("Sell offer", () => {
	test("has no bid, and the comparables the stated rule gives for this miner's weight and pool", () => {
		const offer = sellOffer({ miner: MINER, market: MARKET });
		const rule = sellComparables({
			miner: { mining: true, pool: "verified", weight: 10n },
			sales: MARKET.sales,
			asks: MARKET.asks,
			at: AT,
		});
		expect(offer).toEqual({
			option: "sell",
			minerKey: KEY,
			bid: { state: "none", checkedAt: AT.time },
			sales: rule.sales,
			asks: rule.asks,
		});
		expect(offer.sales.range.state).toBe("shown");
		expect(offer.asks.leftOut).toBe(1);
	});

	test("refuses a miner read at another block than the market", () => {
		expect(() =>
			sellOffer({
				miner: { ...MINER, readAt: { ...AT, block: AT.block + 1n } },
				market: MARKET,
			}),
		).toThrow(ValuationInputError);
	});

	test("a miner that isn't mining gets no comparables, and still no bid", () => {
		const offer = sellOffer({
			miner: {
				...MINER,
				status: "cooling",
				weight: 0n,
				weightWithoutBonus: 0n,
			},
			market: MARKET,
		});
		expect(offer.bid).toEqual({ state: "none", checkedAt: AT.time });
		expect([offer.sales.range, offer.asks.range]).toEqual([
			{ state: "not-mining" },
			{ state: "not-mining" },
		]);
		expect(offer.sales.items).toEqual([]);
	});

	test("an unverified miner compares only with unverified sales and asks", () => {
		const offer = sellOffer({
			miner: { ...MINER, pool: "unverified", taskId: null },
			market: MARKET,
		});
		expect(offer.sales.pool).toBe("unverified");
		expect(offer.sales.items).toEqual([]);
		expect(offer.asks.items).toEqual([]);
	});
});
