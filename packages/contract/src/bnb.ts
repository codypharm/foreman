// When and where a BNB Chain read happened. Mining runs on BNB Smart Chain (chain id 56),
// so a miner or network state read anywhere else is a reader bug.

import { ContractParseError } from "./errors.ts";
import { parseObject, parseUint, serialiseUint } from "./wire.ts";

export interface BnbRead {
	chainId: 56;
	block: bigint;
	/** The block's timestamp, Unix seconds. */
	time: bigint;
}

export function parseBnbRead(wire: unknown, field: string): BnbRead {
	const w = parseObject(wire, field);
	if (w.chainId !== 56) {
		throw new ContractParseError(
			`${field}.chainId`,
			"56 (BNB Smart Chain, where mining runs)",
			w.chainId,
		);
	}
	return {
		chainId: 56,
		block: parseUint(w.block, `${field}.block`),
		time: parseUint(w.time, `${field}.time`),
	};
}

export function serialiseBnbRead(
	read: BnbRead,
	field: string,
): Record<string, unknown> {
	return {
		chainId: read.chainId,
		block: serialiseUint(read.block, `${field}.block`),
		time: serialiseUint(read.time, `${field}.time`),
	};
}
