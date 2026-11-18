import { describe, expect, test } from "vitest";
import { outputRange, projectedOutput, ValuationInputError } from "./index.ts";

const START = 1_787_318_132n; // emission start, 21 Aug 2026
const DAY = 86_400n;
const window = {
	networkWeight: 1_000n,
	from: START + 10n * DAY,
	to: START + 40n * DAY,
};
const growth = { fast: 20_000n, expected: 10_000n, slow: 0n }; // 2%, 1%, 0% a day

describe("output range: low / base / high", () => {
	test("low = weight without the design bonus at fast growth; base = expected growth; high = slow growth", () => {
		const range = outputRange({
			...window,
			minerWeight: 4n,
			weightWithoutBonus: 1n,
			growth,
		});

		expect(range).toEqual({
			low: projectedOutput({
				...window,
				minerWeight: 1n,
				dailyGrowthPpm: growth.fast,
			}),
			base: projectedOutput({
				...window,
				minerWeight: 4n,
				dailyGrowthPpm: growth.expected,
			}),
			high: projectedOutput({
				...window,
				minerWeight: 4n,
				dailyGrowthPpm: growth.slow,
			}),
		});
		expect(range.low).toBeLessThan(range.base);
		expect(range.base).toBeLessThan(range.high);
	});
});

describe("output range refuses inputs that would mislabel the scenarios", () => {
	test.each([
		[
			"fast growth below expected growth",
			{ growth: { fast: 5_000n, expected: 10_000n, slow: 0n } },
			/growth/i,
		],
		[
			"expected growth below slow growth",
			{ growth: { fast: 20_000n, expected: 0n, slow: 10_000n } },
			/growth/i,
		],
		[
			"weight without bonus above today's weight",
			{ weightWithoutBonus: 5n },
			/bonus/i,
		],
		[
			"growth of -100% a day or worse",
			{ growth: { fast: 0n, expected: 0n, slow: -1_000_000n } },
			/growth/i,
		],
	])("%s is an error", (_, override, message) => {
		const call = () =>
			outputRange({
				...window,
				minerWeight: 4n,
				weightWithoutBonus: 1n,
				growth,
				...override,
			});
		expect(call).toThrow(ValuationInputError);
		expect(call).toThrow(message);
	});
});
