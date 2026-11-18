// Projected output when network weight grows by a fixed share each day (compounding).
// The miner's own weight is held fixed; the scenarios pick the growth rate.
// Rewards accumulate like the contract's per-pool accumulator (ACC = 1e27) and are
// rounded down once at the end, as a claim would be.

import { ValuationInputError } from "./errors.ts";
import { expectedOutput, poolEmissionBetween } from "./output.ts";

const DAY = 86_400n;
const PPM = 1_000_000n;
/** The mining contract's accumulator precision. */
const ACC = 10n ** 27n;

export interface ProjectionInputs {
	/** The miner's verified weight. */
	minerWeight: bigint;
	/** Total verified weight at the window start. */
	networkWeight: bigint;
	/** Network weight growth per day, in parts per million (10,000 = 1% a day). */
	dailyGrowthPpm: bigint;
	/** Window start, Unix seconds. */
	from: bigint;
	/** Window end, Unix seconds. */
	to: bigint;
}

/** Projected BEM a verified miner earns over [from, to), in base units. */
export function projectedOutput(inputs: ProjectionInputs): bigint {
	const { minerWeight, networkWeight, dailyGrowthPpm, from, to } = inputs;
	if (dailyGrowthPpm <= -PPM) {
		throw new ValuationInputError(
			`Daily network growth must be above -100% (-1,000,000 ppm), got ${dailyGrowthPpm}`,
		);
	}
	// Validates the weights and the window, and covers the no-growth case exactly
	const flat = expectedOutput({
		pool: "verified",
		minerWeight,
		networkWeight,
		from,
		to,
	});
	if (dailyGrowthPpm === 0n) return flat;

	let accumulated = 0n; // pool emission per unit of weight, × ACC
	let weight = networkWeight;
	for (let dayStart = from; dayStart < to; dayStart += DAY) {
		const dayEnd = dayStart + DAY < to ? dayStart + DAY : to;
		accumulated +=
			(poolEmissionBetween("verified", dayStart, dayEnd) * ACC) / weight;
		// Round the grown weight up: a bigger network means a smaller share, so this errs low
		weight = ceilDiv(weight * (PPM + dailyGrowthPpm), PPM);
	}
	return (minerWeight * accumulated) / ACC;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}
