import { describe, expect, test } from "vitest";
import { expectedOutput, ValuationInputError } from "./index.ts";

const START = 1_787_318_132n; // emission start, 21 Aug 2026
const DAY = 86_400n;
const DAY_10 = START + 10n * DAY;

describe("expected output of a verified miner over a window", () => {
	test("is its share of network weight × the verified pool's 99% of emission", () => {
		// One day emits 719,999,971,200; the unverified 1% is 7,199,999,712 (rounded down,
		// as the contract does), leaving 712,799,971,488 for verified miners.
		// 1/100 of that = 7,127,999,714.88 → rounded down
		expect(
			expectedOutput({
				pool: "verified",
				minerWeight: 1n,
				networkWeight: 100n,
				from: DAY_10,
				to: DAY_10 + DAY,
			}),
		).toBe(7_127_999_714n);
	});
});

describe("expected output of an unverified miner over a window", () => {
	test("is its share of the unverified pool weight × the 1% unverified pool", () => {
		// One day's unverified 1% is 7,199,999,712; 1/10 of it = 719,999,971.2 → rounded down
		expect(
			expectedOutput({
				pool: "unverified",
				minerWeight: 1n,
				unverifiedPoolWeight: 10n,
				from: DAY_10,
				to: DAY_10 + DAY,
			}),
		).toBe(719_999_971n);
	});
});

describe("expected output refuses bad inputs", () => {
	const oneDay = { pool: "verified", from: DAY_10, to: DAY_10 + DAY } as const;

	test.each([
		[
			"network weight of zero",
			{ minerWeight: 1n, networkWeight: 0n },
			/network weight/i,
		],
		[
			"miner weight above network weight (stale or mismatched reads)",
			{ minerWeight: 101n, networkWeight: 100n },
			/miner weight/i,
		],
		[
			"negative miner weight",
			{ minerWeight: -1n, networkWeight: 100n },
			/miner weight/i,
		],
	])("%s is an error, never a zero or a crash", (_, weights, message) => {
		const call = () => expectedOutput({ ...oneDay, ...weights });
		expect(call).toThrow(ValuationInputError);
		expect(call).toThrow(message);
	});
});
