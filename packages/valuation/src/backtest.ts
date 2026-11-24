// The forecast backtest (docs/decisions/2026-11-24-forecast-backtest.md): how often the 30-day range
// held. For every start date with 30 days of samples before it (to set the rates, as the app does that
// day) and 30 days fully over after it, the range the app would have shown is compared with the output
// a verified miner of unchanged weight actually earned on the real network. Code, never a model.

import { ValuationInputError } from "./errors.ts";
import { type DailySample, growthRates } from "./growth.ts";
import { poolEmissionBetween } from "./output.ts";
import { type OutputRange, outputRange } from "./range.ts";

const DAY = 86_400n;
/** The mining contract's accumulator precision, as in the projection. */
const ACC = 10n ** 27n;
/** The forecast tested: the next 30 days. */
const HORIZON_DAYS = 30n;
/** The growth rates look back over the 30 days before the start. */
const LOOK_BACK_DAYS = 30n;
const PPM = 1_000_000n;
/**
 * The tested miner's weight: verified, no design bonus, unchanged over the window. Every such miner's
 * output is in proportion to its weight, so the size only sets the rounding: 1,000 earns about
 * 10^10 base units in 30 days on today's network.
 */
export const BACKTEST_MINER_WEIGHT = 1_000n;

export interface BacktestWindow {
	/** 00:00 UTC of the start date, Unix seconds. */
	start: bigint;
	/** The 30-day range the app would have shown that day. */
	range: OutputRange;
	/**
	 * What the miner actually earned over the 30 days: each day's real verified network weight (its
	 * 00:00 UTC sample) held for that day, accrued like the projection and the mining contract.
	 */
	actual: bigint;
	/** Held when low ≤ actual ≤ high; otherwise the side it missed on. */
	outcome: "held" | "below-low" | "above-high";
}

export interface BacktestSummary {
	horizonDays: number;
	/** How many start dates were tested. Neighbours share most of their 30 days. */
	starts: number;
	/** How many start dates' actual output fell between low and high, inclusive. */
	held: number;
	firstStart: bigint;
	lastStart: bigint;
	/**
	 * |base − actual| ÷ actual in parts per million, rounded up so the error is never understated.
	 * The median (for an even count, the mean of the middle two, rounded up) and the worst.
	 */
	baseErrorMedianPpm: bigint;
	baseErrorWorstPpm: bigint;
	belowLow: number;
	aboveHigh: number;
}

export interface Backtest {
	windows: BacktestWindow[];
	summary: BacktestSummary;
}

export function backtest(samples: DailySample[]): Backtest {
	const byDay = new Map(samples.map((s) => [s.time - (s.time % DAY), s]));
	const days = [...byDay.keys()].sort(compare);
	const first = days[0];
	const last = days.at(-1);
	if (first === undefined || last === undefined) {
		throw new ValuationInputError("The backtest needs network samples");
	}
	const windows: BacktestWindow[] = [];
	for (
		let start = first + LOOK_BACK_DAYS * DAY;
		start + HORIZON_DAYS * DAY <= last;
		start += DAY
	) {
		const network = byDay.get(start);
		if (!network) throw missing(start);
		const rates = growthRates(samples, { readAt: start });
		const range = outputRange({
			minerWeight: BACKTEST_MINER_WEIGHT,
			weightWithoutBonus: BACKTEST_MINER_WEIGHT,
			networkWeight: network.verifiedWeight,
			growth: {
				fast: rates.low.value,
				expected: rates.base.value,
				slow: rates.high.value,
			},
			from: start,
			to: start + HORIZON_DAYS * DAY,
		});
		const actual = actualOutput(byDay, start);
		const outcome =
			actual < range.low
				? "below-low"
				: actual > range.high
					? "above-high"
					: "held";
		windows.push({ start, range, actual, outcome });
	}
	return { windows, summary: summarise(windows) };
}

function summarise(windows: BacktestWindow[]): BacktestSummary {
	const firstStart = windows[0]?.start;
	const lastStart = windows.at(-1)?.start;
	if (firstStart === undefined || lastStart === undefined) {
		throw new ValuationInputError(
			`The backtest needs ${LOOK_BACK_DAYS + HORIZON_DAYS + 1n} consecutive days of network samples`,
		);
	}
	const errors = windows.map(baseErrorPpm).sort(compare);
	const half = Math.floor(errors.length / 2);
	const median =
		errors.length % 2 === 1
			? (errors[half] ?? 0n)
			: ((errors[half - 1] ?? 0n) + (errors[half] ?? 0n) + 1n) / 2n;
	const count = (o: BacktestWindow["outcome"]) =>
		windows.filter((w) => w.outcome === o).length;
	return {
		horizonDays: Number(HORIZON_DAYS),
		starts: windows.length,
		held: count("held"),
		firstStart,
		lastStart,
		baseErrorMedianPpm: median,
		baseErrorWorstPpm: errors.at(-1) ?? 0n,
		belowLow: count("below-low"),
		aboveHigh: count("above-high"),
	};
}

function baseErrorPpm(w: BacktestWindow): bigint {
	const gap = w.range.base - w.actual;
	const abs = gap < 0n ? -gap : gap;
	return (abs * PPM + w.actual - 1n) / w.actual;
}

function missing(day: bigint): ValuationInputError {
	const date = new Date(Number(day) * 1000).toISOString().slice(0, 10);
	return new ValuationInputError(
		`No network sample for ${date}: the backtest needs every day`,
	);
}

function actualOutput(byDay: Map<bigint, DailySample>, start: bigint): bigint {
	let accumulated = 0n; // pool emission per unit of weight, × ACC
	for (let day = start; day < start + HORIZON_DAYS * DAY; day += DAY) {
		const network = byDay.get(day);
		if (!network) throw missing(day);
		accumulated +=
			(poolEmissionBetween("verified", day, day + DAY) * ACC) /
			network.verifiedWeight;
	}
	return (BACKTEST_MINER_WEIGHT * accumulated) / ACC;
}

const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
