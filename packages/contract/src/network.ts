// NetworkState: the mining contract's totals at one block. Network weight is the
// denominator of every valuation, so it carries the block it was read at.

import { type BnbRead, parseBnbRead, serialiseBnbRead } from "./bnb.ts";
import { ContractParseError } from "./errors.ts";
import { parseObject, parseUint, serialiseUint } from "./wire.ts";

export interface NetworkState {
	/** totalVerifWeight */
	verifiedWeight: bigint;
	/** totalUnverWeight */
	unverifiedWeight: bigint;
	minerCount: bigint;
	verifiedMinerCount: bigint;
	readAt: BnbRead;
}

export function parseNetworkState(wire: unknown, field: string): NetworkState {
	const w = parseObject(wire, field);
	const minerCount = parseUint(w.minerCount, `${field}.minerCount`);
	const verifiedMinerCount = parseUint(
		w.verifiedMinerCount,
		`${field}.verifiedMinerCount`,
	);
	if (verifiedMinerCount > minerCount) {
		throw new ContractParseError(
			`${field}.verifiedMinerCount`,
			`at most the miner count (${minerCount})`,
			verifiedMinerCount,
		);
	}
	return {
		verifiedWeight: parseUint(w.verifiedWeight, `${field}.verifiedWeight`),
		unverifiedWeight: parseUint(
			w.unverifiedWeight,
			`${field}.unverifiedWeight`,
		),
		minerCount,
		verifiedMinerCount,
		readAt: parseBnbRead(w.readAt, `${field}.readAt`),
	};
}

/** Network state for the wire. Parses its own output, so it never sends what readers would refuse. */
export function serialiseNetworkState(
	network: NetworkState,
	field: string,
): Record<string, unknown> {
	const wire = {
		verifiedWeight: serialiseUint(
			network.verifiedWeight,
			`${field}.verifiedWeight`,
		),
		unverifiedWeight: serialiseUint(
			network.unverifiedWeight,
			`${field}.unverifiedWeight`,
		),
		minerCount: serialiseUint(network.minerCount, `${field}.minerCount`),
		verifiedMinerCount: serialiseUint(
			network.verifiedMinerCount,
			`${field}.verifiedMinerCount`,
		),
		readAt: serialiseBnbRead(network.readAt, `${field}.readAt`),
	};
	parseNetworkState(wire, field);
	return wire;
}
