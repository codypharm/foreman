import { describe, expect, test } from "vitest";
import { parsePayback, serialisePayback } from "./index.ts";

// Payback for the miner's own asking price (docs/decisions/2026-11-20-payback-and-bem-price.md).

const KEY =
	"0x3f9a00000000000000000000000000000000000000000000000000000000c21e";
const READ_AT = { chainId: 56, block: "134739204", time: "1795197496" };
const AT_BLOCK = { source: "chain", chainId: 56, block: "134739204" };
const GROWTH = "growth measured over the last 14 days";

/** 9.25 BNB at 0.0185 BNB a BEM: exactly 500 BEM. */
function wireShown(overrides: Record<string, unknown> = {}) {
	return {
		state: "shown",
		minerKey: KEY,
		listingId: "28111",
		ask: { currency: "BNB", value: "9250000000000000000" },
		bemPrice: {
			bnbPerBem: "18500000000000000",
			pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2",
			averagedOver: 1800,
			poolBem: "474238142846",
			poolWbnb: "17807194421184457178",
			readAt: READ_AT,
		},
		askInBem: "50000000000",
		days: { low: null, base: "61", high: "44" },
		inputs: {
			minerWeight: {
				low: { value: "140", ...AT_BLOCK },
				base: { value: "140", ...AT_BLOCK },
				high: { value: "140", ...AT_BLOCK },
			},
			networkWeight: { value: "1609667", ...AT_BLOCK },
			growthPpm: {
				low: { value: "10000", source: "assumption", basis: GROWTH },
				base: { value: "4000", source: "assumption", basis: GROWTH },
				high: { value: "0", source: "assumption", basis: GROWTH },
			},
			emissionRate: {
				value: "8333333",
				source: "constant",
				ref: "PodMining.INITIAL_RATE",
			},
		},
		readAt: READ_AT,
		model: { version: "v0.1", backtest: "pending" },
		...overrides,
	};
}

describe("payback on the wire", () => {
	test("carries the ask, the BEM price it used, the days for each case and the valuation's inputs", () => {
		const payback = parsePayback(wireShown(), "payback");
		expect(payback).toMatchObject({
			state: "shown",
			listingId: 28_111n,
			ask: { currency: "BNB", value: 9_250_000_000_000_000_000n },
			askInBem: 50_000_000_000n,
			days: { low: null, base: 61n, high: 44n },
			readAt: { chainId: 56, block: 134_739_204n, time: 1_795_197_496n },
		});
		expect(serialisePayback(payback, "payback")).toEqual(wireShown());
	});

	test.each([
		[
			{ ask: { currency: "OKB", value: "1" } },
			"payback.ask.currency",
			"the BNB market's asks are BNB",
		],
		[
			{ ask: { currency: "BNB", value: "0" } },
			"payback.ask.value",
			"a zero ask",
		],
		[
			{ askInBem: "49999999999" },
			"payback.askInBem",
			"not the ask at the stated price, rounded up",
		],
		[
			{ days: { low: "60", base: "61", high: "44" } },
			"payback.days",
			"low shorter than base",
		],
		[
			{ days: { low: null, base: null, high: "44" } },
			"payback.days",
			"allowed: null is the longest",
		],
		[
			{ days: { low: "61", base: "61", high: null } },
			"payback.days",
			"high never earned back while low is",
		],
		[
			{ days: { low: "3", base: "2", high: "0" } },
			"payback.days.high",
			"day 0",
		],
		[
			{
				bemPrice: {
					...wireShown().bemPrice,
					readAt: { ...READ_AT, block: "134739203" },
				},
			},
			"payback.bemPrice.readAt.block",
			"a price from another block",
		],
	] as [Record<string, unknown>, string, string][])(
		"%j at %s: %s",
		(overrides, field, why) => {
			const parse = () => parsePayback(wireShown(overrides), "payback");
			if (why.startsWith("allowed")) {
				expect(parse).not.toThrow();
				return;
			}
			expect(parse).toThrow(
				expect.objectContaining({ name: "ContractParseError", field }),
			);
		},
	);

	test("the ask in BEM is rounded up, so payback errs long", () => {
		const ask = { currency: "BNB", value: "9250000000000000001" };
		expect(
			parsePayback(wireShown({ ask, askInBem: "50000000001" }), "payback"),
		).toMatchObject({ askInBem: 50_000_000_001n });
		expect(() =>
			parsePayback(wireShown({ ask, askInBem: "50000000000" }), "payback"),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: "payback.askInBem",
			}),
		);
	});

	test.each([
		[{ state: "not-listed", minerKey: KEY, readAt: READ_AT }],
		[{ state: "not-mining", minerKey: KEY, readAt: READ_AT }],
		[
			{
				state: "no-price",
				minerKey: KEY,
				reason:
					"The BEM/WBNB pool has only 25 seconds of price history; the average needs 1800",
				readAt: READ_AT,
			},
		],
	])("a missing payback is a state, never a number of days: %j", (wire) => {
		const payback = parsePayback(wire, "payback");
		expect(payback).not.toHaveProperty("days");
		expect(serialisePayback(payback, "payback")).toEqual(wire);
	});

	test("no price needs its reason", () => {
		expect(() =>
			parsePayback(
				{ state: "no-price", minerKey: KEY, reason: "", readAt: READ_AT },
				"payback",
			),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: "payback.reason",
			}),
		);
	});
});
