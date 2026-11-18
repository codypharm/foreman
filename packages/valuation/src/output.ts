// Expected output of a miner over a time window, from its share of its pool's weight.
// Mirrors the sealed PoD mining contract's `_update` and `_accrued`
// (docs/notes/2026-11-18-mining-contract-findings.md). Today's weights are assumed
// to hold for the whole window; the scenarios decide how they change.

import { emissionBetween } from "./emission.ts";
import { ValuationInputError } from "./errors.ts";

/** The unverified pool's share of each emission, in basis points (contract `UNVERIFIED_BPS`). */
const UNVERIFIED_BPS = 100n;

interface Window {
	/** Window start, Unix seconds. */
	from: bigint;
	/** Window end, Unix seconds. */
	to: bigint;
}

/** A verified miner earns from the 99% verified pool. */
export interface VerifiedOutputInputs extends Window {
	pool: "verified";
	/** The miner's verified weight in the mining contract. */
	minerWeight: bigint;
	/** Total verified weight across all miners. */
	networkWeight: bigint;
}

/** An unverified miner (no task solved) earns from the 1% unverified pool. */
export interface UnverifiedOutputInputs extends Window {
	pool: "unverified";
	/** The miner's unverified weight in the mining contract. */
	minerWeight: bigint;
	/** Total unverified weight across all unverified miners (contract `totalUnverWeight`). */
	unverifiedPoolWeight: bigint;
}

export type ExpectedOutputInputs =
	| VerifiedOutputInputs
	| UnverifiedOutputInputs;

/** Expected BEM a miner earns over [from, to), in base units, rounded down. */
export function expectedOutput(inputs: ExpectedOutputInputs): bigint {
	const { minerWeight, from, to } = inputs;
	const [poolWeight, poolWeightName] =
		inputs.pool === "verified"
			? [inputs.networkWeight, "network weight"]
			: [inputs.unverifiedPoolWeight, "unverified pool weight"];

	if (minerWeight < 0n) {
		throw new ValuationInputError(
			`Miner weight cannot be negative, got ${minerWeight}`,
		);
	}
	if (poolWeight <= 0n) {
		throw new ValuationInputError(
			`The ${poolWeightName} must be above zero, got ${poolWeight}`,
		);
	}
	if (minerWeight > poolWeight) {
		throw new ValuationInputError(
			`Miner weight ${minerWeight} is above the ${poolWeightName} ${poolWeight}; the reads are stale or mismatched`,
		);
	}

	return (
		(minerWeight * poolEmissionBetween(inputs.pool, from, to)) / poolWeight
	);
}

/**
 * Emission paid to one pool over [from, to), split as the contract does:
 * the unverified 1% is rounded down and the verified pool gets the rest.
 */
export function poolEmissionBetween(
	pool: "verified" | "unverified",
	from: bigint,
	to: bigint,
): bigint {
	const minted = emissionBetween(from, to);
	const unverifiedShare = (minted * UNVERIFIED_BPS) / 10_000n;
	return pool === "verified" ? minted - unverifiedShare : unverifiedShare;
}
