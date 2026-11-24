import { describe, expect, test } from "vitest";
import { backtestWords, growthWords } from "./worth-words.ts";

// The words under the range (docs/mocks/2026-11-24-backtest-line.html, B): what the backtest found, from
// the numbers the API sends, and the high case's "No network growth".

const BACKTEST = {
	horizonDays: 30,
	starts: 34,
	held: 34,
	firstStart: 1_789_948_800n,
	lastStart: 1_792_800_000n,
	baseErrorMedianPpm: 70_559n,
	baseErrorWorstPpm: 409_701n,
	belowLow: 0,
	aboveHigh: 0,
	ref: "README.md#the-forecast-backtest",
};

function shown(words: ReturnType<typeof backtestWords>) {
	if (words === null || words === "pending")
		throw new Error(`no result: ${words}`);
	return words;
}

describe("the backtest line", () => {
	test("on the 30-day tab, how often the range held, over which start dates, and the base error", () => {
		expect(backtestWords(BACKTEST, "30d")).toEqual({
			held: "34 of 34",
			rest: "past 30-day windows (21 Sep to 24 Oct, overlapping). Base was off by 7.1% typically, 41.0% at worst.",
		});
	});

	test("rounds the base error up, so it's never understated", () => {
		const words = backtestWords(
			{ ...BACKTEST, baseErrorMedianPpm: 70_001n, baseErrorWorstPpm: 100_000n },
			"30d",
		);
		expect(shown(words).rest).toMatch(
			/off by 7\.1% typically, 10\.0% at worst/,
		);
	});

	test("says when the range missed, not only when it held", () => {
		expect(
			shown(backtestWords({ ...BACKTEST, held: 13, aboveHigh: 21 }, "30d"))
				.held,
		).toBe("13 of 34");
	});

	test("the halving tab says it isn't tested, whatever the 30-day result", () => {
		expect(backtestWords(BACKTEST, "to-2030-halving")).toBeNull();
		expect(backtestWords("pending", "to-2030-halving")).toBeNull();
	});

	test("a model not yet backtested says so", () => {
		expect(backtestWords("pending", "30d")).toBe("pending");
	});
});

describe("a growth case's words", () => {
	test("no growth is said in words, not as +0%", () => {
		expect(growthWords(0n)).toBe("No network growth");
	});

	test("growth and shrinking carry their sign", () => {
		expect(growthWords(1_873n)).toBe("Network +0.19% a day");
		expect(growthWords(-2_416n)).toBe("Network −0.24% a day");
	});
});
