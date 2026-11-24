// Words for the Worth card (docs/mocks/2026-11-24-backtest-line.html, B): the backtest line under the
// range, and each growth case's note. Only formats what the API sends; the numbers come from the
// valuation package's backtest (docs/decisions/2026-11-24-forecast-backtest.md).

import type { Valuation } from "@foreman/contract";
import { formatPpmPercent } from "../../format.ts";

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

/**
 * The 30-day tab's backtest line: how many start dates held (shown bold) and the rest of the sentence.
 * "pending" for a model not yet backtested; null on the halving tab, which is never backtested.
 */
export function backtestWords(
	backtest: Valuation["model"]["backtest"],
	window: Valuation["window"]["label"],
): { held: string; rest: string } | "pending" | null {
	if (window !== "30d") return null;
	if (backtest === "pending") return "pending";
	return {
		held: `${backtest.held} of ${backtest.starts}`,
		rest:
			`past ${backtest.horizonDays}-day windows (${dayMonth(backtest.firstStart)} to ${dayMonth(backtest.lastStart)}, overlapping). ` +
			`Base was off by ${percentUp(backtest.baseErrorMedianPpm)} typically, ${percentUp(backtest.baseErrorWorstPpm)} at worst.`,
	};
}

/** A growth case's note: "No network growth", or the rate with its sign. */
export function growthWords(ppm: bigint): string {
	if (ppm === 0n) return "No network growth";
	return ppm > 0n
		? `Network +${formatPpmPercent(ppm)}% a day`
		: `Network −${formatPpmPercent(-ppm)}% a day`;
}

/** Parts per million as a percentage with one decimal, rounded up so an error is never understated. */
function percentUp(ppm: bigint): string {
	const tenths = (ppm + 999n) / 1_000n;
	return `${tenths / 10n}.${tenths % 10n}%`;
}

function dayMonth(unix: bigint): string {
	const d = new Date(Number(unix) * 1000);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
