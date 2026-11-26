// The keyed bulk results call, POST /v1/results (docs/data-contract.md, "API responses";
// docs/decisions/2026-11-26-api-keys.md, decisions 2 to 4): up to 100 circuits in, each one's result
// and where it was published out, in the order asked. A circuit that can't be checked says so with its
// reason, never a verdict.

import {
	type Published,
	parsePublished,
	parseStoredCheck,
	type StoredCheck,
	serialisePublished,
	serialiseStoredCheck,
} from "./api-shared.ts";
import { ContractParseError } from "./errors.ts";
import { type ChainId, parseChainId } from "./sourced.ts";
import {
	type Address,
	parseAddress,
	parseObject,
	parseUint,
	serialiseUint,
} from "./wire.ts";

/** The most circuits one call may ask for. */
export const BULK_MAX = 100;

/** A circuit as the caller names it: its chain, processor and id. */
export interface BulkCircuit {
	chainId: ChainId;
	processor: Address;
	tokenId: bigint;
}

export interface BulkRequest {
	circuits: BulkCircuit[];
}

export interface BulkResult {
	circuit: BulkCircuit;
	check: StoredCheck;
	/** Where the result was published on X Layer; "not-published" for one built on request. */
	published: Published;
}

export interface BulkResults {
	results: BulkResult[];
}

function parseBulkCircuit(wire: unknown, field: string): BulkCircuit {
	const w = parseObject(wire, field);
	return {
		chainId: parseChainId(w.chainId, `${field}.chainId`),
		// One spelling per circuit, whatever case the caller sent
		processor: parseAddress(
			typeof w.processor === "string" ? w.processor.toLowerCase() : w.processor,
			`${field}.processor`,
		),
		tokenId: parseUint(w.tokenId, `${field}.tokenId`),
	};
}

function parseList(wire: unknown, field: string): unknown[] {
	if (!Array.isArray(wire)) {
		throw new ContractParseError(field, "a list", wire);
	}
	return wire;
}

export function parseBulkRequest(wire: unknown, field: string): BulkRequest {
	const w = parseObject(wire, field);
	const list = parseList(w.circuits, `${field}.circuits`);
	if (list.length === 0 || list.length > BULK_MAX) {
		throw new ContractParseError(
			`${field}.circuits`,
			`1 to ${BULK_MAX} circuits`,
			`${list.length} circuits`,
		);
	}
	return {
		circuits: list.map((c, i) =>
			parseBulkCircuit(c, `${field}.circuits[${i}]`),
		),
	};
}

export function parseBulkResults(wire: unknown, field: string): BulkResults {
	const w = parseObject(wire, field);
	return {
		results: parseList(w.results, `${field}.results`).map((r, i) => {
			const f = `${field}.results[${i}]`;
			const o = parseObject(r, f);
			return {
				circuit: parseBulkCircuit(o.circuit, `${f}.circuit`),
				check: parseStoredCheck(o.check, `${f}.check`),
				published: parsePublished(o.published, `${f}.published`),
			};
		}),
	};
}

function serialiseBulkCircuit(c: BulkCircuit, field: string) {
	return {
		chainId: c.chainId,
		processor: c.processor,
		tokenId: serialiseUint(c.tokenId, `${field}.tokenId`),
	};
}

/** For the wire, and for a caller building a request. */
export function serialiseBulkRequest(
	request: BulkRequest,
	field: string,
): Record<string, unknown> {
	const wire = {
		circuits: request.circuits.map((c, i) =>
			serialiseBulkCircuit(c, `${field}.circuits[${i}]`),
		),
	};
	parseBulkRequest(wire, field);
	return wire;
}

/** For the wire. Parses its own output, so it never sends what readers would refuse. */
export function serialiseBulkResults(
	results: BulkResults,
	field: string,
): Record<string, unknown> {
	const wire = {
		results: results.results.map((r, i) => {
			const f = `${field}.results[${i}]`;
			return {
				circuit: serialiseBulkCircuit(r.circuit, `${f}.circuit`),
				check: serialiseStoredCheck(r.check, `${f}.check`),
				published: serialisePublished(r.published, `${f}.published`),
			};
		}),
	};
	parseBulkResults(wire, field);
	return wire;
}
