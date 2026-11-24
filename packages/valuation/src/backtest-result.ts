// The forecast backtest's result for this model version (docs/decisions/2026-11-24-forecast-backtest.md,
// decision 5): fixed, from a saved fixture, so anyone can rerun it and get the same numbers.
// backtest.test.ts proves the fixture gives exactly this. Rerun by hand before submitting, with a
// newer fixture, and whenever MODEL_VERSION changes: `pnpm --filter @foreman/valuation backtest`.

import type { BacktestSummary } from "./backtest.ts";

export const BACKTEST_RESULT: {
	modelVersion: string;
	fixture: string;
	summary: BacktestSummary;
} = {
	modelVersion: "2026-11-24",
	fixture: "packages/valuation/fixtures/network-daily-20260822-20261123.json",
	summary: {
		horizonDays: 30,
		starts: 34,
		held: 34,
		/** 21 Sep 2026, 00:00 UTC. */
		firstStart: 1_789_948_800n,
		/** 24 Oct 2026, 00:00 UTC. */
		lastStart: 1_792_800_000n,
		baseErrorMedianPpm: 70_559n,
		baseErrorWorstPpm: 409_701n,
		belowLow: 0,
		aboveHigh: 0,
	},
};
