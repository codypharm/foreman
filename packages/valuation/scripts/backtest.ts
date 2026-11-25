// Reruns the forecast backtest from a saved fixture of daily network samples and prints every start
// date and the summary (docs/decisions/2026-11-24-forecast-backtest.md). No chain reads: anyone can
// rerun it and get the same numbers.
//
//   pnpm --filter @foreman/valuation backtest [fixture.json]
//
// The default fixture is the one BACKTEST_RESULT was computed from.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BACKTEST_RESULT, backtest, MODEL_VERSION } from "../src/index.ts";

const path =
	process.argv[2] ??
	resolve(import.meta.dirname, "../../..", BACKTEST_RESULT.fixture);
const recorded = JSON.parse(readFileSync(path, "utf8")) as {
	samples: {
		time: number | string;
		block: number | string;
		verifiedWeight: string;
	}[];
};
const { windows, summary } = backtest(
	recorded.samples.map((s) => ({
		time: BigInt(s.time),
		block: BigInt(s.block),
		verifiedWeight: BigInt(s.verifiedWeight),
	})),
);

const day = (t: bigint) =>
	new Date(Number(t) * 1000).toISOString().slice(0, 10);
const bem = (v: bigint) => (Number(v) / 1e8).toFixed(2).padStart(8);
/** Rounded up to one decimal, as the screen shows it, so an error is never understated. */
const pct = (ppm: bigint) => {
	const tenths = (ppm + 999n) / 1_000n;
	return `${tenths / 10n}.${tenths % 10n}%`;
};

console.log(`Model ${MODEL_VERSION}, ${path}`);
console.log(
	"A verified miner of weight 1,000 with no design bonus, over the next 30 days, in BEM",
);
console.log("start           low     base     high   actual  outcome");
for (const w of windows) {
	console.log(
		`${day(w.start)} ${bem(w.range.low)} ${bem(w.range.base)} ${bem(w.range.high)} ${bem(w.actual)}  ${w.outcome}`,
	);
}
console.log(
	`\nHeld in ${summary.held} of ${summary.starts} start dates (${day(summary.firstStart)} to ${day(summary.lastStart)}, overlapping); ` +
		`below low ${summary.belowLow}, above high ${summary.aboveHigh}; ` +
		`base off by ${pct(summary.baseErrorMedianPpm)} typically, ${pct(summary.baseErrorWorstPpm)} at worst`,
);
