// Low / base / high output for a verified miner over a window.
// Low assumes the miner loses its design bonus from the window start (if it holds one)
// and the network grows fast; base keeps today's weight at expected growth; high keeps
// today's weight at slow growth. Decided with William, 18 Nov 2026.

import { ValuationInputError } from "./errors.ts";
import { projectedOutput } from "./projection.ts";

export interface GrowthScenarios {
	/** Fastest daily network weight growth, in parts per million: used for low. */
	fast: bigint;
	/** Expected daily growth: used for base. */
	expected: bigint;
	/** Slowest daily growth: used for high. */
	slow: bigint;
}

export interface OutputRangeInputs {
	/** The miner's verified weight today. */
	minerWeight: bigint;
	/**
	 * The weight the miner drops to if a better design takes its design bonus
	 * (base figure × processor factor). Equals minerWeight when it holds no bonus.
	 */
	weightWithoutBonus: bigint;
	/** Total verified weight at the window start. */
	networkWeight: bigint;
	growth: GrowthScenarios;
	/** Window start, Unix seconds. */
	from: bigint;
	/** Window end, Unix seconds. */
	to: bigint;
}

export interface OutputRange {
	low: bigint;
	base: bigint;
	high: bigint;
}

/** Projected BEM over [from, to) under the low, base and high scenarios, in base units. */
export function outputRange(inputs: OutputRangeInputs): OutputRange {
	const { minerWeight, weightWithoutBonus, networkWeight, growth, from, to } =
		inputs;
	if (growth.fast < growth.expected || growth.expected < growth.slow) {
		throw new ValuationInputError(
			`Growth scenarios must run fast ≥ expected ≥ slow, got ${growth.fast}, ${growth.expected}, ${growth.slow} ppm a day`,
		);
	}
	if (weightWithoutBonus > minerWeight) {
		throw new ValuationInputError(
			`Weight without the design bonus (${weightWithoutBonus}) cannot be above today's weight (${minerWeight})`,
		);
	}
	const window = { networkWeight, from, to };
	return {
		low: projectedOutput({
			...window,
			minerWeight: weightWithoutBonus,
			dailyGrowthPpm: growth.fast,
		}),
		base: projectedOutput({
			...window,
			minerWeight,
			dailyGrowthPpm: growth.expected,
		}),
		high: projectedOutput({
			...window,
			minerWeight,
			dailyGrowthPpm: growth.slow,
		}),
	};
}
