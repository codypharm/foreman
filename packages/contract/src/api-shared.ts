// Pieces the API's responses share (docs/data-contract.md, "API responses"; approved 21 Nov 2026 in
// docs/decisions/2026-11-21-api-endpoints.md). A stored result that isn't there is "not checked",
// shown as "Can't check", never a verdict by default.

import { ContractParseError } from "./errors.ts";
import {
	type Amount,
	type ChainRead,
	parseAmount,
	parseChainRead,
} from "./offer.ts";
import {
	type Originality,
	parseOriginality,
	serialiseOriginality,
} from "./originality.ts";
import {
	type Address,
	type Hex32,
	parseAddress,
	parseBoolean,
	parseHex32,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
	serialiseUint,
} from "./wire.ts";

/** A circuit's stored result, read from the results table, never built on request. */
export type StoredCheck =
	| { state: "checked"; originality: Originality }
	| { state: "not-checked"; detail: string };

/** An open listing on TapeOut's BNB market. */
export interface ListingAsk {
	listingId: bigint;
	seller: Address;
	/** BNB, what the buyer pays. */
	ask: Amount;
	/** The Listed event's block and its timestamp. */
	listedAt: { block: bigint; time: bigint };
	/** false when a buy would revert, e.g. the seller revoked approval. */
	buyable: boolean;
	readAt: ChainRead;
}

export type PublishedAt = { chainId: 196 | 1952; block: bigint; tx: Hex32 };

/** From Foreman's record of what it published: current when the stored result's hash is the published one. */
export type Published =
	| {
			state: "current" | "older";
			publishedAt: PublishedAt;
			contract: Address;
			resultHash: Hex32;
	  }
	| { state: "not-published"; reason: "pasted" | "not-yet" };

export function parseStoredCheck(wire: unknown, field: string): StoredCheck {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"checked",
		"not-checked",
	] as const);
	if (state === "not-checked") {
		return { state, detail: parseText(w.detail, `${field}.detail`) };
	}
	return {
		state,
		originality: parseOriginality(w.originality, `${field}.originality`),
	};
}

export function serialiseStoredCheck(
	check: StoredCheck,
	field: string,
): Record<string, unknown> {
	return check.state === "not-checked"
		? { state: check.state, detail: check.detail }
		: {
				state: check.state,
				originality: serialiseOriginality(
					check.originality,
					`${field}.originality`,
				),
			};
}

export function parseListingAsk(wire: unknown, field: string): ListingAsk {
	const w = parseObject(wire, field);
	const listingId = parseUint(w.listingId, `${field}.listingId`);
	if (listingId === 0n) {
		throw new ContractParseError(
			`${field}.listingId`,
			"a listing number above 0",
			listingId,
		);
	}
	const listedAt = parseObject(w.listedAt, `${field}.listedAt`);
	return {
		listingId,
		seller: parseAddress(w.seller, `${field}.seller`),
		ask: parseAmount(w.ask, `${field}.ask`, { only: "BNB", positive: true }),
		listedAt: {
			block: parseUint(listedAt.block, `${field}.listedAt.block`),
			time: parseUint(listedAt.time, `${field}.listedAt.time`),
		},
		buyable: parseBoolean(w.buyable, `${field}.buyable`),
		readAt: parseChainRead(w.readAt, `${field}.readAt`, 56),
	};
}

export function serialiseListingAsk(
	listing: ListingAsk,
	field: string,
): Record<string, unknown> {
	return toWire(listing, field) as Record<string, unknown>;
}

export function parsePublished(wire: unknown, field: string): Published {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"current",
		"older",
		"not-published",
	] as const);
	if (state === "not-published") {
		return {
			state,
			reason: parseOneOf(w.reason, `${field}.reason`, [
				"pasted",
				"not-yet",
			] as const),
		};
	}
	const at = parseObject(w.publishedAt, `${field}.publishedAt`);
	if (at.chainId !== 196 && at.chainId !== 1952) {
		throw new ContractParseError(
			`${field}.publishedAt.chainId`,
			"196 or 1952 (X Layer mainnet or testnet)",
			at.chainId,
		);
	}
	return {
		state,
		publishedAt: {
			chainId: at.chainId,
			block: parseUint(at.block, `${field}.publishedAt.block`),
			tx: parseHex32(at.tx, `${field}.publishedAt.tx`),
		},
		contract: parseAddress(w.contract, `${field}.contract`),
		resultHash: parseHex32(w.resultHash, `${field}.resultHash`),
	};
}

export function serialisePublished(
	published: Published,
	field: string,
): Record<string, unknown> {
	return toWire(published, field) as Record<string, unknown>;
}

/** bigints become decimal strings; everything else is already the wire shape. Only for parts with no signed numbers. */
export function toWire(value: unknown, field: string): unknown {
	if (typeof value === "bigint") return serialiseUint(value, field);
	if (Array.isArray(value)) return value.map((v) => toWire(v, field));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, toWire(v, field)]),
		);
	}
	return value;
}
