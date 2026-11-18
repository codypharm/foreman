import { describe, expect, test } from "vitest";
import { expectedOutput, projectedOutput } from "./index.ts";

const START = 1_787_318_132n; // emission start, 21 Aug 2026
const DAY = 86_400n;
const DAY_10 = START + 10n * DAY;

describe("projected output with network weight growing a fixed share each day", () => {
	test("with zero growth it equals expected output at today's weights", () => {
		const window = {
			minerWeight: 1n,
			networkWeight: 100n,
			from: DAY_10,
			to: DAY_10 + 30n * DAY,
		};
		expect(projectedOutput({ ...window, dailyGrowthPpm: 0n })).toBe(
			expectedOutput({ pool: "verified", ...window }),
		);
	});

	test("network weight compounds daily; rounding happens once, at the end, like a claim", () => {
		// Day 1 at weight 100: 712,799,971,488 / 100 = 7,127,999,714.88
		// Day 2 at weight 110: 712,799,971,488 / 110 = 6,479,999,740.8
		// Total 13,607,999,455.68 → 13,607,999,455 (rounding each day would give …454)
		expect(
			projectedOutput({
				minerWeight: 1n,
				networkWeight: 100n,
				dailyGrowthPpm: 100_000n, // 10% a day
				from: DAY_10,
				to: DAY_10 + 2n * DAY,
			}),
		).toBe(13_607_999_455n);
	});

	test("grown network weight rounds up, so the estimate errs low, never high", () => {
		// Day 1 at weight 3: 712,799,971,488 / 3 = 237,599,990,496
		// Day 2: 3 × 1.5 = 4.5 → 5 (not 4): 712,799,971,488 / 5 = 142,559,994,297.6
		expect(
			projectedOutput({
				minerWeight: 1n,
				networkWeight: 3n,
				dailyGrowthPpm: 500_000n, // 50% a day
				from: DAY_10,
				to: DAY_10 + 2n * DAY,
			}),
		).toBe(380_159_984_793n);
	});

	test("a partial last day counts for the part of the day in the window", () => {
		// Day 1 at 100: 7,127,999,714.88; half a day at 110: 356,399,985,744 / 110 = 3,239,999,870.4
		expect(
			projectedOutput({
				minerWeight: 1n,
				networkWeight: 100n,
				dailyGrowthPpm: 100_000n,
				from: DAY_10,
				to: DAY_10 + DAY + DAY / 2n,
			}),
		).toBe(10_367_999_585n);
	});
});
