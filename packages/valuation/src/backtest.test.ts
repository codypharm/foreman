import { describe, expect, test } from "vitest";
import recorded from "../fixtures/network-daily-20260822-20261123.json" with {
	type: "json",
};
import {
	BACKTEST_MINER_WEIGHT,
	BACKTEST_RESULT,
	backtest,
	type DailySample,
	emissionBetween,
	expectedOutput,
	growthRates,
	MODEL_VERSION,
	outputRange,
	ValuationInputError,
} from "./index.ts";

// The forecast backtest (docs/decisions/2026-11-24-forecast-backtest.md): for every past start date with
// 30 days before it and 30 days after, the 30-day range the app would have shown that day against the
// output a verified miner of unchanged weight actually earned. The fixture is the index's 94 daily
// network samples, 22 Aug to 23 Nov 2026 at 00:00 UTC.

const DAY = 86_400n;
const SAMPLES: DailySample[] = recorded.samples.map((s) => ({
	time: BigInt(s.time),
	block: BigInt(s.block),
	verifiedWeight: BigInt(s.verifiedWeight),
}));
/** 21 Sep and 24 Oct 2026, 00:00 UTC. */
const FIRST_START = 1_789_948_800n;
const LAST_START = 1_792_800_000n;

/** 61 daily samples from 22 Aug 2026: one start date, with the network weight the function gives on day i. */
function network(weightOnDay: (i: number) => bigint): DailySample[] {
	const first = BigInt(recorded.samples[0]?.time ?? 0);
	return Array.from({ length: 61 }, (_, i) => ({
		time: first - (first % DAY) + BigInt(i) * DAY + 3n,
		block: BigInt(i),
		verifiedWeight: weightOnDay(i),
	}));
}

describe("the forecast backtest", () => {
	test("tests every start date with 30 days before it and 30 days fully over after it", () => {
		const { windows } = backtest(SAMPLES);
		expect(windows).toHaveLength(34);
		expect(windows[0]?.start).toBe(FIRST_START);
		expect(windows.at(-1)?.start).toBe(LAST_START);
		expect(
			windows.every((w, i) => w.start === FIRST_START + BigInt(i) * DAY),
		).toBe(true);
	});

	test("each window's range is the one the app would have shown that day, for a miner without a design bonus", () => {
		const { windows } = backtest(SAMPLES);
		for (const w of [windows[0], windows[17], windows.at(-1)]) {
			if (!w) throw new Error("no window");
			const rates = growthRates(SAMPLES, { readAt: w.start });
			const network = SAMPLES.find((s) => s.time - (s.time % DAY) === w.start);
			if (!network) throw new Error("no sample at the start");
			expect(w.range).toEqual(
				outputRange({
					minerWeight: BACKTEST_MINER_WEIGHT,
					weightWithoutBonus: BACKTEST_MINER_WEIGHT,
					networkWeight: network.verifiedWeight,
					growth: {
						fast: rates.low.value,
						expected: rates.base.value,
						slow: rates.high.value,
					},
					from: w.start,
					to: w.start + 30n * DAY,
				}),
			);
		}
	});

	test("the actual output holds each day's real network weight for that day and accrues like the mining contract", () => {
		const ACC = 10n ** 27n;
		const { windows } = backtest(SAMPLES);
		for (const w of [windows[0], windows.at(-1)]) {
			if (!w) throw new Error("no window");
			let accumulated = 0n;
			for (let day = w.start; day < w.start + 30n * DAY; day += DAY) {
				const network = SAMPLES.find((s) => s.time - (s.time % DAY) === day);
				if (!network) throw new Error("no sample");
				const minted = emissionBetween(day, day + DAY);
				const verified = minted - (minted * 100n) / 10_000n;
				accumulated += (verified * ACC) / network.verifiedWeight;
			}
			expect(w.actual).toBe((BACKTEST_MINER_WEIGHT * accumulated) / ACC);
		}
	});

	test("on a network that didn't change, the actual output is the flat expected output", () => {
		const flat: DailySample[] = SAMPLES.map((s) => ({
			...s,
			verifiedWeight: 1_500_000n,
		}));
		const [w] = backtest(flat).windows;
		if (!w) throw new Error("no window");
		expect(w.actual).toBe(
			expectedOutput({
				pool: "verified",
				minerWeight: BACKTEST_MINER_WEIGHT,
				networkWeight: 1_500_000n,
				from: w.start,
				to: w.start + 30n * DAY,
			}),
		);
	});

	test("the range held when the actual output is between low and high, both included", () => {
		const [w] = backtest(network(() => 1_500_000n)).windows;
		expect(w?.range.low).toBe(w?.actual);
		expect(w?.range.high).toBe(w?.actual);
		expect(w?.outcome).toBe("held");
	});

	test("a network that grew faster than ever before is a miss below low", () => {
		const [w] = backtest(
			network((i) => (i <= 30 ? 1_500_000n : 3_000_000n)),
		).windows;
		expect(w?.actual).toBeLessThan(w?.range.low ?? 0n);
		expect(w?.outcome).toBe("below-low");
	});

	test("a network that shrank is a miss above high", () => {
		const [w] = backtest(
			network((i) => (i <= 30 ? 1_500_000n : 1_000_000n)),
		).windows;
		expect(w?.actual).toBeGreaterThan(w?.range.high ?? 0n);
		expect(w?.outcome).toBe("above-high");
	});

	test("the summary counts the start dates, how many held and the misses by side", () => {
		const { windows, summary } = backtest(SAMPLES);
		expect(summary.horizonDays).toBe(30);
		expect(summary.starts).toBe(34);
		expect(summary.firstStart).toBe(FIRST_START);
		expect(summary.lastStart).toBe(LAST_START);
		const count = (o: string) => windows.filter((w) => w.outcome === o).length;
		expect(summary.held).toBe(count("held"));
		expect(summary.belowLow).toBe(count("below-low"));
		expect(summary.aboveHigh).toBe(count("above-high"));
		expect(summary.held + summary.belowLow + summary.aboveHigh).toBe(34);
	});

	test("base error is how far base was from the actual output, as a share of actual, rounded up: the median and the worst", () => {
		const { windows, summary } = backtest(SAMPLES);
		const errors = windows
			.map((w) => {
				const gap = w.range.base - w.actual;
				const abs = gap < 0n ? -gap : gap;
				return (abs * 1_000_000n + w.actual - 1n) / w.actual;
			})
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		// 34 start dates: the median is the mean of the 17th and 18th, rounded up
		const middle = (errors[16] ?? 0n) + (errors[17] ?? 0n);
		expect(summary.baseErrorMedianPpm).toBe((middle + 1n) / 2n);
		expect(summary.baseErrorWorstPpm).toBe(errors.at(-1));
	});

	test("a network that didn't change has no base error", () => {
		const { summary } = backtest(network(() => 1_500_000n));
		expect(summary.baseErrorMedianPpm).toBe(0n);
		expect(summary.baseErrorWorstPpm).toBe(0n);
	});

	test("a missing day after a start date is a clear error, never a silent result", () => {
		const gap = network(() => 1_500_000n).filter((_, i) => i !== 45);
		expect(() => backtest(gap)).toThrow(ValuationInputError);
		expect(() => backtest(gap)).toThrow(/2026-10-06/);
	});

	test("too few days to test even one start date is a clear error", () => {
		expect(() => backtest(SAMPLES.slice(0, 60))).toThrow(ValuationInputError);
	});

	test("the stored result is this model version's, and the saved samples give it exactly", () => {
		expect(BACKTEST_RESULT.modelVersion).toBe(MODEL_VERSION);
		expect(BACKTEST_RESULT.fixture).toBe(
			"packages/valuation/fixtures/network-daily-20260822-20261123.json",
		);
		expect(backtest(SAMPLES).summary).toEqual(BACKTEST_RESULT.summary);
	});
});
