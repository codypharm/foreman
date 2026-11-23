// The Check box's answer (docs/data-contract.md, "API responses"; approved 21 Nov 2026 in
// docs/decisions/2026-11-21-api-endpoints.md): the one circuit an input names. How each input finds
// it: docs/decisions/2026-11-22-check-box-input.md. Anything not found is an ApiError instead.

import {
	type Address,
	parseAddress,
	parseObject,
	parseUint,
	serialiseUint,
} from "./wire.ts";

export interface CheckAnswer {
	processor: Address;
	tokenId: bigint;
}

export function parseCheckAnswer(wire: unknown, field: string): CheckAnswer {
	const w = parseObject(wire, field);
	return {
		processor: parseAddress(w.processor, `${field}.processor`),
		tokenId: parseUint(w.tokenId, `${field}.tokenId`),
	};
}

/** For the wire. Parses its own output, so it never sends what readers would refuse. */
export function serialiseCheckAnswer(
	answer: CheckAnswer,
	field: string,
): Record<string, unknown> {
	const wire = {
		processor: answer.processor,
		tokenId: serialiseUint(answer.tokenId, `${field}.tokenId`),
	};
	parseCheckAnswer(wire, field);
	return wire;
}
