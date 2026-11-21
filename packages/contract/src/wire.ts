// Wire format (docs/data-contract.md): every bigint crosses JSON as a decimal string of
// base units. A value that does not parse is an error, never a zero or a default.

import { ContractParseError } from "./errors.ts";

/** A whole number (amount, weight, time, block) from its decimal string on the wire. */
export function parseUint(wire: unknown, field: string): bigint {
	if (typeof wire !== "string" || !DECIMAL.test(wire)) {
		throw new ContractParseError(field, "a decimal string of base units", wire);
	}
	return BigInt(wire);
}

/** A whole number that may be negative, such as a growth rate. Same one-spelling rule. */
export function parseSignedInt(wire: unknown, field: string): bigint {
	if (typeof wire !== "string" || !SIGNED_DECIMAL.test(wire)) {
		throw new ContractParseError(
			field,
			"a decimal string, optionally negative",
			wire,
		);
	}
	return BigInt(wire);
}

/** A whole number that may be negative, as its decimal string for the wire. */
export function serialiseSignedInt(value: bigint, _field: string): string {
	return value.toString(10);
}

/** A whole number as its decimal string for the wire. Refuses what no reader would accept. */
export function serialiseUint(value: bigint, field: string): string {
	if (value < 0n) {
		throw new ContractParseError(
			field,
			"a whole number of zero or more",
			value,
		);
	}
	return value.toString(10);
}

/** A 20-byte address, lowercase 0x hex. Only `parseAddress` makes one. */
export type Address = `0x${string}` & { readonly __kind: "Address" };

/** An address from the wire. Mixed or upper case is refused: the wire has one spelling. */
export function parseAddress(wire: unknown, field: string): Address {
	if (typeof wire !== "string" || !ADDRESS.test(wire)) {
		throw new ContractParseError(
			field,
			"a lowercase 0x address of 20 bytes",
			wire,
		);
	}
	return wire as Address;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** 32 bytes, lowercase 0x hex: a miner key or a transaction hash. Only `parseHex32` makes one. */
export type Hex32 = `0x${string}` & { readonly __kind: "Hex32" };

/** A miner key or transaction hash from the wire. */
export function parseHex32(wire: unknown, field: string): Hex32 {
	if (typeof wire !== "string" || !HEX32.test(wire)) {
		throw new ContractParseError(field, "lowercase 0x hex of 32 bytes", wire);
	}
	return wire as Hex32;
}

const HEX32 = /^0x[0-9a-f]{64}$/;

/** A JSON object (not null, not an array), for a shape's parser to read fields from. */
export function parseObject(
	wire: unknown,
	field: string,
): Record<string, unknown> {
	if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
		throw new ContractParseError(field, "an object", wire);
	}
	return wire as Record<string, unknown>;
}

/** One of a fixed set of words, such as a status. */
export function parseOneOf<const T extends string>(
	wire: unknown,
	field: string,
	allowed: readonly T[],
): T {
	if (
		typeof wire !== "string" ||
		!(allowed as readonly string[]).includes(wire)
	) {
		throw new ContractParseError(
			field,
			`one of ${allowed.map((a) => `"${a}"`).join(", ")}`,
			wire,
		);
	}
	return wire as T;
}

/** Text that says something: empty or blank text is refused. */
export function parseText(wire: unknown, field: string): string {
	if (typeof wire !== "string" || wire.trim() === "") {
		throw new ContractParseError(field, "non-empty text", wire);
	}
	return wire;
}

/** true or false, never a truthy stand-in. */
export function parseBoolean(wire: unknown, field: string): boolean {
	if (typeof wire !== "boolean") {
		throw new ContractParseError(field, "true or false", wire);
	}
	return wire;
}

/** A small whole number (a count, an index) as a JSON number. */
export function parseCount(wire: unknown, field: string): number {
	if (!Number.isSafeInteger(wire) || (wire as number) < 0) {
		throw new ContractParseError(field, "a whole number of zero or more", wire);
	}
	return wire as number;
}

/** Digits only, no sign, no padding, no leading zeros: one way to write each number. */
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** As DECIMAL, with an optional minus sign; "-0" is refused because 0 is written "0". */
const SIGNED_DECIMAL = /^(0|-?[1-9][0-9]*)$/;
