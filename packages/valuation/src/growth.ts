// Growth rates for the low, base and high cases, from the verified network weight sampled daily
// at 00:00 UTC (docs/decisions/2026-11-20-growth-rates.md). Code, never a model. Rates are parts
// per million a day, compounding, rounded up so a value errs low.

import type { Scenario, Sourced } from "@foreman/contract";
import { ValuationInputError } from "./errors.ts";

const DAY = 86_400n;
const PPM = 1_000_000n;
/** The look-back: the 30 days before the last midnight. */
const WINDOW_DAYS = 30n;
/** Fastest and slowest are measured over stretches of this many days. */
const STRETCH_DAYS = 7n;

/** The verified network weight at the first block at or after 00:00 UTC of one day. */
export interface DailySample {
	time: bigint;
	block: bigint;
	verifiedWeight: bigint;
}

/**
 * Low = the fastest 7-day stretch, base = the 30 days compounded, high = the slowest 7-day stretch
 * (never below 0), over the 30 days ending at the last midnight at or before `readAt`.
 */
export function growthRates(
	samples: DailySample[],
	at: { readAt: bigint },
): Scenario<Sourced<bigint>> {
	const end = at.readAt - (at.readAt % DAY);
	const start = end - WINDOW_DAYS * DAY;
	const byDay = new Map<bigint, DailySample>();
	for (const s of samples) {
		const day = s.time - (s.time % DAY);
		if (day < start || day > end) continue;
		if (byDay.has(day)) {
			throw new ValuationInputError(`Two network samples for ${date(day)}`);
		}
		byDay.set(day, s);
	}
	const weights: bigint[] = [];
	for (let day = start; day <= end; day += DAY) {
		const s = byDay.get(day);
		if (!s) {
			throw new ValuationInputError(
				`No network sample for ${date(day)}: growth needs every day from ${date(start)} to ${date(end)}`,
			);
		}
		weights.push(s.verifiedWeight);
	}

	const span = `between ${dayMonth(start)} and ${date(end)}`;
	const stretches = [];
	for (let i = 0; i + Number(STRETCH_DAYS) < weights.length; i++) {
		const from = start + BigInt(i) * DAY;
		stretches.push({
			from,
			ppm: dailyRate(
				weightAt(weights, i),
				weightAt(weights, i + Number(STRETCH_DAYS)),
				STRETCH_DAYS,
			),
		});
	}
	// Ties go to the earlier stretch
	const fastest = stretches.reduce((a, b) => (b.ppm > a.ppm ? b : a));
	const slowest = stretches.reduce((a, b) => (b.ppm < a.ppm ? b : a));
	const stretch = (s: { from: bigint }) =>
		`${dayMonth(s.from)} to ${dayMonth(s.from + STRETCH_DAYS * DAY)}`;

	const high: Sourced<bigint> =
		slowest.ppm >= 0n
			? {
					value: slowest.ppm,
					source: "assumption",
					basis: `Slowest 7 days of verified network growth ${span}: ${stretch(slowest)}`,
				}
			: {
					value: 0n,
					source: "assumption",
					basis: `Slowest 7 days of verified network growth ${span}: ${stretch(slowest)}, ${slowest.ppm} ppm a day; the high case assumes no growth, never shrinking`,
				};
	return {
		low: {
			value: fastest.ppm,
			source: "assumption",
			basis: `Fastest 7 days of verified network growth ${span}: ${stretch(fastest)}`,
		},
		base: {
			value: dailyRate(
				weightAt(weights, 0),
				weightAt(weights, weights.length - 1),
				WINDOW_DAYS,
			),
			source: "assumption",
			basis: `Verified network growth compounded from ${dayMonth(start)} to ${date(end)}`,
		},
		high,
	};
}

function weightAt(weights: bigint[], i: number): bigint {
	const w = weights[i];
	if (w === undefined) throw new RangeError(`no weight at ${i}`);
	return w;
}

/**
 * The smallest whole ppm r with (1 + r/10^6)^days ≥ to / from: the daily compounding rate,
 * rounded up. Negative when the network shrank.
 */
function dailyRate(from: bigint, to: bigint, days: bigint): bigint {
	if (from <= 0n) {
		throw new ValuationInputError(`Network weight ${from} can't be grown from`);
	}
	// (PPM + r)^days × from ≥ to × PPM^days, searched over r in (−PPM, upper]
	const reaches = (r: bigint) => (PPM + r) ** days * from >= to * PPM ** days;
	let lo = -PPM + 1n;
	let hi = PPM;
	while (!reaches(hi)) hi *= 2n;
	while (lo < hi) {
		const mid = lo + (hi - lo) / 2n;
		if (reaches(mid)) hi = mid;
		else lo = mid + 1n;
	}
	return lo;
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function dayMonth(time: bigint): string {
	const d = new Date(Number(time) * 1000);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function date(time: bigint): string {
	return `${dayMonth(time)} ${new Date(Number(time) * 1000).getUTCFullYear()}`;
}
