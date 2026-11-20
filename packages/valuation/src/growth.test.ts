import { describe, expect, test } from "vitest";
import recorded from "../fixtures/network-daily-20261021-20261120.json" with {
	type: "json",
};
import { type DailySample, growthRates, ValuationInputError } from "./index.ts";

// The growth rule (docs/decisions/2026-11-20-growth-rates.md), against the real verified network
// weight from 21 October to 20 November 2026. Expected rates worked out separately in Python
// (fixtures/README.md): base 683.02, fastest 7 days 1,872.49 (from 7 Nov), slowest 81.44 (from
// 23 Oct), in parts per million a day, each rounded up.

const DAY = 86_400n;
const SAMPLES: DailySample[] = recorded.samples.map((s) => ({
	time: BigInt(s.time),
	block: BigInt(s.block),
	verifiedWeight: BigInt(s.verifiedWeight),
}));
/** 20 Nov 2026, 00:00 UTC: the last sample. */
const LAST = 1_795_132_800n;

describe("growth rates", () => {
	test("low is the fastest 7 days, base the 30 days, high the slowest 7 days, rounded up", () => {
		const rates = growthRates(SAMPLES, { readAt: LAST + 3_600n });
		expect(rates).toEqual({
			low: {
				value: 1_873n,
				source: "assumption",
				basis:
					"Fastest 7 days of verified network growth between 21 Oct and 20 Nov 2026: 7 Nov to 14 Nov",
			},
			base: {
				value: 684n,
				source: "assumption",
				basis: "Verified network growth compounded from 21 Oct to 20 Nov 2026",
			},
			high: {
				value: 82n,
				source: "assumption",
				basis:
					"Slowest 7 days of verified network growth between 21 Oct and 20 Nov 2026: 23 Oct to 30 Oct",
			},
		});
	});

	test("refuses a window with a missing day, naming it, never guessing a rate", () => {
		const missing = SAMPLES.filter((s) => s.time !== LAST - 10n * DAY);
		expect(() => growthRates(missing, { readAt: LAST })).toThrow(
			new ValuationInputError(
				"No network sample for 10 Nov 2026: growth needs every day from 21 Oct 2026 to 20 Nov 2026",
			),
		);
	});

	test("refuses two samples for the same day", () => {
		const first = SAMPLES[0];
		if (!first) throw new Error("no samples");
		expect(() =>
			growthRates([...SAMPLES, { ...first, time: first.time + 60n }], {
				readAt: LAST,
			}),
		).toThrow(ValuationInputError);
	});

	test("the 30 days end at the last midnight at or before the read", () => {
		// A sample after that midnight, with a huge jump, changes nothing
		const later = {
			time: LAST + DAY,
			block: 134_800_000n,
			verifiedWeight: 10_000_000n,
		};
		const rates = growthRates([...SAMPLES, later], {
			readAt: LAST + DAY - 1n,
		});
		expect(rates.base.value).toBe(684n);
		expect(rates.low.value).toBe(1_873n);
	});

	test("the high case never assumes the network shrinks, and says what was measured", () => {
		// The network loses 10,000 a day for the first 7 days (7%), then holds:
		// 0.93^(1/7) − 1 = −10,313.8 ppm a day, rounded up to −10,313
		const shrinking = SAMPLES.map((s, i) => ({
			...s,
			verifiedWeight: 1_000_000n - 10_000n * BigInt(Math.min(i, 7)),
		}));
		const rates = growthRates(shrinking, { readAt: LAST });
		expect(rates.high).toEqual({
			value: 0n,
			source: "assumption",
			basis:
				"Slowest 7 days of verified network growth between 21 Oct and 20 Nov 2026: 21 Oct to 28 Oct, -10313 ppm a day; the high case assumes no growth, never shrinking",
		});
		// Low and base keep what was measured, even shrinking
		expect(rates.base.value).toBeLessThan(0n);
		expect(rates.low.value).toBe(0n);
		// Every flat week ties as fastest: the earliest is named
		expect(rates.low).toMatchObject({
			basis: expect.stringMatching(/: 28 Oct to 4 Nov$/),
		});
	});

	test("the last 7 days count as a stretch", () => {
		// A 10% jump on the last day makes the last week the fastest
		const last = SAMPLES.length - 1;
		const jumped = SAMPLES.map((s, i) =>
			i === last ? { ...s, verifiedWeight: (s.verifiedWeight * 11n) / 10n } : s,
		);
		expect(growthRates(jumped, { readAt: LAST }).low).toMatchObject({
			basis: expect.stringMatching(/: 13 Nov to 20 Nov$/),
		});
	});
});
