import { describe, expect, test } from "vitest";
import { emissionBetween, ValuationInputError } from "./index.ts";

// Mining contract facts (docs/notes/2026-11-18-mining-contract-findings.md)
const START = 1_787_318_132n; // 21 Aug 2026, 13:15:32 UTC
const DAY = 86_400n;
const FIRST_HALVING = START + 126_000_000n; // 18 Aug 2030, 21:15:32 UTC

describe("emission schedule", () => {
	test("one day in the first era is 8,333,333 base units a second (7,199.999712 BEM)", () => {
		const from = START + 10n * DAY;
		expect(emissionBetween(from, from + DAY)).toBe(719_999_971_200n);
	});

	test("nothing is emitted before mining started", () => {
		expect(emissionBetween(START - 2n * DAY, START - DAY)).toBe(0n);
		// A window straddling the start counts only from the start
		expect(emissionBetween(START - DAY, START + DAY)).toBe(719_999_971_200n);
	});

	test("the rate halves every 126,000,000 seconds", () => {
		// One day before the first halving at the full rate, one day after at half
		// (8,333,333 >> 1 = 4,166,666 base units a second)
		expect(emissionBetween(FIRST_HALVING - DAY, FIRST_HALVING + DAY)).toBe(
			719_999_971_200n + 359_999_942_400n,
		);
	});

	test("emission ends: all eras total 20,999,984.04 BEM, under the 21 million cap", () => {
		const farFuture = START + 1_000n * 365n * DAY;
		expect(emissionBetween(START, farFuture)).toBe(2_099_998_404_000_000n);
		expect(emissionBetween(farFuture, farFuture + DAY)).toBe(0n);
	});

	test("a window that ends before it starts is an error, never a zero", () => {
		const from = START + 10n * DAY;
		const call = () => emissionBetween(from, from - DAY);
		expect(call).toThrow(ValuationInputError);
		expect(call).toThrow(/window/i);
	});
});
