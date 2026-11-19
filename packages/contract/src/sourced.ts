// Sourced<T>: every number shown to an owner says where it came from (CLAUDE.md,
// "No chain data, no number"). A value without a source does not parse.

import { ContractParseError } from "./errors.ts";
import { parseObject, parseText, parseUint, serialiseUint } from "./wire.ts";

export type ChainId = 56 | 196;

export type Sourced<T> =
	| { value: T; source: "chain"; chainId: ChainId; block: bigint }
	/** `ref` names the constant, such as "PodMining.INITIAL_RATE". */
	| { value: T; source: "constant"; ref: string }
	/** `basis` says what the assumption rests on, in words an owner can read. */
	| { value: T; source: "assumption"; basis: string };

/** A sourced value from the wire; `parseValue` reads the value itself. */
export function parseSourced<T>(
	wire: unknown,
	field: string,
	parseValue: (wire: unknown, field: string) => T,
): Sourced<T> {
	const w = parseObject(wire, field);
	switch (w.source) {
		case "chain":
			return {
				value: parseValue(w.value, `${field}.value`),
				source: "chain",
				chainId: parseChainId(w.chainId, `${field}.chainId`),
				block: parseUint(w.block, `${field}.block`),
			};
		case "constant":
			return {
				value: parseValue(w.value, `${field}.value`),
				source: "constant",
				ref: parseText(w.ref, `${field}.ref`),
			};
		case "assumption":
			return {
				value: parseValue(w.value, `${field}.value`),
				source: "assumption",
				basis: parseText(w.basis, `${field}.basis`),
			};
		default:
			throw new ContractParseError(
				`${field}.source`,
				'"chain", "constant" or "assumption"',
				w.source,
			);
	}
}

/** A sourced value for the wire; `serialiseValue` writes the value itself. */
export function serialiseSourced<T>(
	sourced: Sourced<T>,
	field: string,
	serialiseValue: (value: T, field: string) => unknown,
): Record<string, unknown> {
	const value = serialiseValue(sourced.value, `${field}.value`);
	switch (sourced.source) {
		case "chain":
			return {
				value,
				source: "chain",
				chainId: sourced.chainId,
				block: serialiseUint(sourced.block, `${field}.block`),
			};
		case "constant":
			return { value, source: "constant", ref: sourced.ref };
		case "assumption":
			return { value, source: "assumption", basis: sourced.basis };
	}
}

/** BNB Smart Chain (mining) or X Layer (offers, rules circuits, the owner wallet). */
export function parseChainId(wire: unknown, field: string): ChainId {
	if (wire !== 56 && wire !== 196) {
		throw new ContractParseError(
			field,
			"56 (BNB Smart Chain) or 196 (X Layer)",
			wire,
		);
	}
	return wire;
}
