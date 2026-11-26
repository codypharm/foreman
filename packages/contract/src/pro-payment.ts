// Reporting a Foreman Pro payment (docs/decisions/2026-11-26-pro-payments.md, decision 5): the page
// sends the transaction that paid, and the API answers when the chat's Pro now ends. The chat itself
// is never named: only its code is on chain.

import { ContractParseError } from "./errors.ts";
import {
	type Hex32,
	parseHex32,
	parseObject,
	parseUint,
	serialiseUint,
} from "./wire.ts";

export interface ProPaymentRequest {
	txHash: Hex32;
}

export interface ProPaymentAnswer {
	txHash: Hex32;
	/** When the paying code's chat has Pro until (Unix seconds); null when the code is no chat's. */
	proUntil: bigint | null;
}

export function parseProPaymentRequest(
	wire: unknown,
	field: string,
): ProPaymentRequest {
	const w = parseObject(wire, field);
	return {
		txHash: parseHex32(
			typeof w.txHash === "string" ? w.txHash.toLowerCase() : w.txHash,
			`${field}.txHash`,
		),
	};
}

export function serialiseProPaymentRequest(
	request: ProPaymentRequest,
	field: string,
): Record<string, unknown> {
	const wire = { txHash: request.txHash };
	parseProPaymentRequest(wire, field);
	return wire;
}

export function parseProPaymentAnswer(
	wire: unknown,
	field: string,
): ProPaymentAnswer {
	const w = parseObject(wire, field);
	if (!("proUntil" in w)) {
		throw new ContractParseError(
			`${field}.proUntil`,
			"a time or null",
			"missing",
		);
	}
	return {
		txHash: parseHex32(w.txHash, `${field}.txHash`),
		proUntil:
			w.proUntil === null ? null : parseUint(w.proUntil, `${field}.proUntil`),
	};
}

export function serialiseProPaymentAnswer(
	answer: ProPaymentAnswer,
	field: string,
): Record<string, unknown> {
	const wire = {
		txHash: answer.txHash,
		proUntil:
			answer.proUntil === null
				? null
				: serialiseUint(answer.proUntil, `${field}.proUntil`),
	};
	parseProPaymentAnswer(wire, field);
	return wire;
}
