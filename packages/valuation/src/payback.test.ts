import {
	type BemPrice,
	type BnbRead,
	parseHex32,
	type Valuation,
} from "@foreman/contract";
import { describe, expect, test } from "vitest";
import { type PaybackInput, payback, projectedOutput } from "./index.ts";

// Payback for the miner's own asking price (docs/decisions/2026-11-20-payback-and-bem-price.md).
//
// A miner of weight 1,000 in a verified network of weight 1,000,000 earns 1/1,000 of the verified
// pool (the projection rounds the grown network up to whole units, negligible at this size):
// 8,333,333 base units a second × 86,400 × 99% ÷ 1,000 ≈ 712,800,000 base units (7.128 BEM) a day.
// The ask, 9.25 BNB at 0.0185 BNB a BEM, is 500 BEM. Worked by hand:
// - no growth: 500 ÷ 7.128 = 70.15 days, so day 71;
// - 1% a day: 7.128 × 101 × (1 − 1.01^−n) ≥ 500 gives n ≥ 119.2, so day 120;
// - 2% a day: everything the miner will ever earn is 7.128 × 51 ≈ 363.5 BEM, so never.

const KEY = parseHex32(`0x${"ab".repeat(32)}`, "key");
const READ_AT: BnbRead = {
	chainId: 56,
	block: 134_739_204n,
	time: 1_795_197_496n,
};
const chain = (value: bigint) => ({
	value,
	source: "chain" as const,
	chainId: 56 as const,
	block: READ_AT.block,
});
const assumed = (value: bigint) => ({
	value,
	source: "assumption" as const,
	basis: "test growth",
});
const INPUTS: Valuation["inputs"] = {
	minerWeight: { low: chain(1_000n), base: chain(1_000n), high: chain(1_000n) },
	networkWeight: chain(1_000_000n),
	growthPpm: {
		low: assumed(20_000n),
		base: assumed(10_000n),
		high: assumed(0n),
	},
	emissionRate: {
		value: 8_333_333n,
		source: "constant",
		ref: "PodMining.INITIAL_RATE",
	},
};
const MODEL: Valuation["model"] = { version: "v0.1", backtest: "pending" };
const PRICE: BemPrice = {
	bnbPerBem: 18_500_000_000_000_000n,
	pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2" as BemPrice["pool"],
	averagedOver: 1800,
	poolBem: 474_238_142_846n,
	poolWbnb: 17_807_194_421_184_457_178n,
	readAt: READ_AT,
};
const LISTING = { listingId: 28_111n, priceWei: 9_250_000_000_000_000_000n };

const input = (overrides: Partial<PaybackInput> = {}): PaybackInput => ({
	minerKey: KEY,
	readAt: READ_AT,
	miner: { mining: true, inputs: INPUTS, model: MODEL },
	listing: LISTING,
	bemPrice: { available: true, price: PRICE },
	...overrides,
});

describe("payback", () => {
	test("is the first day each case's projected BEM reaches the ask, or never by the 2030 halving", () => {
		expect(payback(input())).toEqual({
			state: "shown",
			minerKey: KEY,
			listingId: 28_111n,
			ask: { currency: "BNB", value: 9_250_000_000_000_000_000n },
			bemPrice: PRICE,
			askInBem: 50_000_000_000n,
			days: { low: null, base: 120n, high: 71n },
			inputs: INPUTS,
			readAt: READ_AT,
			model: MODEL,
		});
	});

	test("each case uses its own weight: the low case has no design bonus", () => {
		const flat = {
			...INPUTS,
			minerWeight: {
				low: chain(500n),
				base: chain(1_000n),
				high: chain(1_000n),
			},
			growthPpm: { low: assumed(0n), base: assumed(0n), high: assumed(0n) },
		};
		// Half the weight, half the BEM a day: 500 ÷ 3.564 = 140.3 days, so day 141
		const result = payback(
			input({ miner: { mining: true, inputs: flat, model: MODEL } }),
		);
		expect(result).toMatchObject({ days: { low: 141n, base: 71n, high: 71n } });
	});

	test("a miner that isn't mining has no payback, even when it is listed", () => {
		expect(payback(input({ miner: { mining: false } }))).toEqual({
			state: "not-mining",
			minerKey: KEY,
			readAt: READ_AT,
		});
	});

	test("a miner with no buyable listing has no asking price to pay back", () => {
		expect(payback(input({ listing: null }))).toEqual({
			state: "not-listed",
			minerKey: KEY,
			readAt: READ_AT,
		});
	});

	test("no 30-minute average is no payback, with the reason, never a number of days", () => {
		const reason =
			"The BEM/WBNB pool has only 25 seconds of price history; the average needs 1800";
		expect(payback(input({ bemPrice: { available: false, reason } }))).toEqual({
			state: "no-price",
			minerKey: KEY,
			reason,
			readAt: READ_AT,
		});
	});

	test("refuses a BEM price read at another block", () => {
		const price = {
			...PRICE,
			readAt: { ...READ_AT, block: READ_AT.block - 1n },
		};
		expect(() =>
			payback(input({ bemPrice: { available: true, price } })),
		).toThrow(expect.objectContaining({ name: "ContractParseError" }));
	});

	test("projected BEM exactly equal to the ask counts as earned back that day", () => {
		const flat = {
			...INPUTS,
			growthPpm: { low: assumed(0n), base: assumed(0n), high: assumed(0n) },
		};
		const seventyOneDays = projectedOutput({
			minerWeight: 1_000n,
			networkWeight: 1_000_000n,
			dailyGrowthPpm: 0n,
			from: READ_AT.time,
			to: READ_AT.time + 71n * 86_400n,
		});
		// At 1 BNB a BEM, an ask of n × 10^10 wei is exactly n BEM base units
		const result = payback(
			input({
				miner: { mining: true, inputs: flat, model: MODEL },
				listing: { listingId: 1n, priceWei: seventyOneDays * 10n ** 10n },
				bemPrice: {
					available: true,
					price: { ...PRICE, bnbPerBem: 10n ** 18n },
				},
			}),
		);
		expect(result).toMatchObject({
			askInBem: seventyOneDays,
			days: { low: 71n, base: 71n, high: 71n },
		});
	});

	test("an ask earned back within the first day is day 1", () => {
		// 0.0185 BNB is 1 BEM; the miner earns 7.128 BEM a day
		const result = payback(
			input({ listing: { listingId: 1n, priceWei: 18_500_000_000_000_000n } }),
		);
		expect(result).toMatchObject({ days: { low: 1n, base: 1n, high: 1n } });
	});

	test("the ask in BEM is rounded up, so payback errs long", () => {
		const result = payback(
			input({
				listing: { listingId: 1n, priceWei: 9_250_000_000_000_000_001n },
			}),
		);
		expect(result).toMatchObject({ askInBem: 50_000_000_001n });
	});
});
