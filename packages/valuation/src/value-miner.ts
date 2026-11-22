// A miner's Valuation from chain reads (docs/decisions/2026-11-18-valuation-model.md): the miner
// and the network read at one block, and growth rates from the daily network samples
// (2026-11-20-growth-rates.md). Code, never a model. Every input carries its source.

import {
	type Miner,
	type NetworkState,
	parseValuation,
	type Sourced,
	serialiseValuation,
	type Valuation,
} from "@foreman/contract";
import { FIRST_HALVING } from "./emission.ts";
import { ValuationInputError } from "./errors.ts";
import { type DailySample, growthRates } from "./growth.ts";
import { outputRange } from "./range.ts";

/**
 * The model's version: the date of the newest decision it follows (the growth rule). Changes
 * whenever a rule behind the numbers changes, so a published value can be recomputed.
 */
export const MODEL_VERSION = "2026-11-20";

/** The contract's emission rate in era 0, until the 2030 halving: 50 BEM per 600 s, rounded down. */
const INITIAL_RATE = 8_333_333n;
const DAY = 86_400n;

/** The miner fields the projection uses: a listing's stored state supplies these too. */
export type ValuedMiner = Pick<
	Miner,
	"key" | "status" | "pool" | "weight" | "weightWithoutBonus" | "readAt"
>;

export function valueMiner(input: {
	miner: ValuedMiner;
	network: NetworkState;
	days: DailySample[];
	window: Valuation["window"]["label"];
}): Valuation {
	const { miner, network, days, window } = input;
	if (miner.readAt.block !== network.readAt.block) {
		throw new ValuationInputError(
			`Miner ${miner.key} was read at block ${miner.readAt.block}, the network at block ${network.readAt.block}`,
		);
	}
	if (miner.status !== "active") {
		throw new ValuationInputError(
			`Miner ${miner.key} is not mining (${miner.status}): it has no estimated value`,
		);
	}
	if (miner.pool !== "verified") {
		throw new ValuationInputError(
			`Miner ${miner.key} is in the unverified pool, which the projection doesn't value yet`,
		);
	}
	const from = network.readAt.time;
	const to = window === "30d" ? from + 30n * DAY : FIRST_HALVING;
	const growth = growthRates(days, { readAt: from });
	const chain = (value: bigint): Sourced<bigint> => ({
		value,
		source: "chain",
		chainId: 56,
		block: network.readAt.block,
	});
	const valuation: Valuation = {
		minerKey: miner.key,
		pool: "verified",
		window: { from, to, label: window },
		range: outputRange({
			minerWeight: miner.weight,
			weightWithoutBonus: miner.weightWithoutBonus,
			networkWeight: network.verifiedWeight,
			growth: {
				fast: growth.low.value,
				expected: growth.base.value,
				slow: growth.high.value,
			},
			from,
			to,
		}),
		inputs: {
			minerWeight: {
				low: chain(miner.weightWithoutBonus),
				base: chain(miner.weight),
				high: chain(miner.weight),
			},
			networkWeight: chain(network.verifiedWeight),
			growthPpm: growth,
			emissionRate: {
				value: INITIAL_RATE,
				source: "constant",
				ref: "PodMining.INITIAL_RATE",
			},
		},
		model: { version: MODEL_VERSION, backtest: "pending" },
	};
	// The contract's checks (ordered ranges and inputs, the window) run on every valuation
	return parseValuation(
		serialiseValuation(valuation, "valuation"),
		"valuation",
	);
}
