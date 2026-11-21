// The live listings page's response (docs/data-contract.md, "API responses"; approved 21 Nov 2026 in
// docs/decisions/2026-11-21-api-endpoints.md): today's open listings on TapeOut's BNB market, each with
// its stored result and a 30-day value from the weight stored with the listing, plus the counts behind
// the filter chips and the fact line. The fact line is built from the counts, never stored as text.

import {
	type ListingAsk,
	listedAfter,
	type Multiplier,
	parseListingAsk,
	parseMultiplier,
	parseStoredCheck,
	type StoredCheck,
	sameWire,
	serialiseListingAsk,
	serialiseStoredCheck,
	toWire,
} from "./api-shared.ts";
import { ContractParseError } from "./errors.ts";
import { type ChainRead, parseChainRead } from "./offer.ts";
import {
	type CircuitRef,
	type Originality,
	type OriginalityVerdict,
	parseCircuitRef,
} from "./originality.ts";
import {
	parseValuation,
	serialiseValuation,
	type Valuation,
} from "./valuation.ts";
import {
	parseCount,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
} from "./wire.ts";

/** The most rows one page carries. */
export const LISTINGS_PAGE_SIZE = 50;

export const LISTING_VERDICTS = [
	"no-earlier-copy",
	"copy",
	"too-small-to-tell",
	"wrapper",
	"cant-check",
	"not-checked",
] as const satisfies readonly (OriginalityVerdict["verdict"] | "not-checked")[];
export type ListingVerdict = (typeof LISTING_VERDICTS)[number];

export interface ListingRow {
	listing: ListingAsk;
	circuit: CircuitRef;
	multiplier: Multiplier;
	check: StoredCheck;
	/** Hold over 30 days, from the weight stored with the listing; no live read. */
	value30d:
		| { state: "shown"; valuation: Valuation }
		| { state: "not-mining" }
		| { state: "not-read"; detail: string };
}

export interface ListingsPage {
	/** mining: buyable listings whose miner is active; all: every open listing. */
	set: "mining" | "all";
	/** The verdict filter applied, null for none. */
	verdict: ListingVerdict | null;
	market: { venue: "bnb-market"; upTo: ChainRead };
	index: Originality["index"];
	counts: {
		open: number;
		buyable: number;
		sellers: number;
		bySet: { mining: number; all: number };
		/** Within the chosen set, before the verdict filter. */
		byVerdict: Record<ListingVerdict, number>;
	};
	/** Newest listing first. */
	rows: ListingRow[];
	/** Cursor for the next page, null on the last. */
	next: string | null;
}

export function parseListingsPage(wire: unknown, field: string): ListingsPage {
	const w = parseObject(wire, field);
	const market = parseObject(w.market, `${field}.market`);
	const counts = parseObject(w.counts, `${field}.counts`);
	const bySet = parseObject(counts.bySet, `${field}.counts.bySet`);
	const byVerdict = parseObject(counts.byVerdict, `${field}.counts.byVerdict`);
	if (!Array.isArray(w.rows)) {
		throw new ContractParseError(`${field}.rows`, "a list of rows", w.rows);
	}
	const page: ListingsPage = {
		set: parseOneOf(w.set, `${field}.set`, ["mining", "all"] as const),
		verdict:
			w.verdict === null
				? null
				: parseOneOf(w.verdict, `${field}.verdict`, LISTING_VERDICTS),
		market: {
			venue: parseOneOf(market.venue, `${field}.market.venue`, [
				"bnb-market",
			] as const),
			upTo: parseChainRead(market.upTo, `${field}.market.upTo`, 56),
		},
		index: parseIndex(w.index, `${field}.index`),
		counts: {
			open: parseCount(counts.open, `${field}.counts.open`),
			buyable: parseCount(counts.buyable, `${field}.counts.buyable`),
			sellers: parseCount(counts.sellers, `${field}.counts.sellers`),
			bySet: {
				mining: parseCount(bySet.mining, `${field}.counts.bySet.mining`),
				all: parseCount(bySet.all, `${field}.counts.bySet.all`),
			},
			byVerdict: Object.fromEntries(
				LISTING_VERDICTS.map((v) => [
					v,
					parseCount(byVerdict[v], `${field}.counts.byVerdict.${v}`),
				]),
			) as Record<ListingVerdict, number>,
		},
		rows: w.rows.map((r, i) => parseRow(r, `${field}.rows[${i}]`)),
		next: w.next === null ? null : parseText(w.next, `${field}.next`),
	};
	checkCounts(page, field);
	checkRows(page, field);
	return page;
}

/** The counts behind the chips and the fact line add up, so the fact line can't overstate. */
function checkCounts(page: ListingsPage, field: string): void {
	const { counts } = page;
	if (counts.buyable > counts.open) {
		throw new ContractParseError(
			`${field}.counts.buyable`,
			`no more than the open listings (${counts.open})`,
			counts.buyable,
		);
	}
	if (counts.bySet.all !== counts.open) {
		throw new ContractParseError(
			`${field}.counts.bySet.all`,
			`the open listings (${counts.open})`,
			counts.bySet.all,
		);
	}
	if (counts.bySet.mining > counts.buyable) {
		throw new ContractParseError(
			`${field}.counts.bySet.mining`,
			`no more than the buyable listings (${counts.buyable})`,
			counts.bySet.mining,
		);
	}
	const sum = LISTING_VERDICTS.reduce((n, v) => n + counts.byVerdict[v], 0);
	if (sum !== counts.bySet[page.set]) {
		throw new ContractParseError(
			`${field}.counts.byVerdict`,
			`verdict counts adding up to the ${page.set} set (${counts.bySet[page.set]})`,
			sum,
		);
	}
}

/** At most a page of rows, newest listing first, each in the chosen set and filter and about its own circuit. */
function checkRows(page: ListingsPage, field: string): void {
	if (page.rows.length > LISTINGS_PAGE_SIZE) {
		throw new ContractParseError(
			`${field}.rows`,
			`at most ${LISTINGS_PAGE_SIZE} rows`,
			page.rows.length,
		);
	}
	page.rows.forEach((row, i) => {
		const at = `${field}.rows[${i}]`;
		const before = page.rows[i - 1];
		if (before && !listedAfter(before.listing, row.listing)) {
			throw new ContractParseError(
				`${at}.listing.listedAt`,
				`listed before the row above it (listing ${before.listing.listingId})`,
				`listing ${row.listing.listingId}`,
			);
		}
		if (
			row.check.state === "checked" &&
			!sameWire(row.check.originality.circuit, row.circuit)
		) {
			throw new ContractParseError(
				`${at}.check.originality.circuit`,
				`the row's circuit (${row.circuit.processor} #${row.circuit.tokenId})`,
				`${row.check.originality.circuit.processor} #${row.check.originality.circuit.tokenId}`,
			);
		}
		const verdict =
			row.check.state === "checked"
				? row.check.originality.result.verdict
				: "not-checked";
		if (page.verdict !== null && verdict !== page.verdict) {
			throw new ContractParseError(
				`${at}.check`,
				`a "${page.verdict}" row, the filter applied`,
				verdict,
			);
		}
		if (page.set === "mining") {
			if (!row.listing.buyable) {
				throw new ContractParseError(
					`${at}.listing.buyable`,
					"true in the mining set",
					false,
				);
			}
			if (row.value30d.state !== "shown") {
				throw new ContractParseError(
					`${at}.value30d`,
					"a value: the mining set is active miners",
					row.value30d.state,
				);
			}
		}
		if (
			row.value30d.state === "shown" &&
			row.value30d.valuation.window.label !== "30d"
		) {
			throw new ContractParseError(
				`${at}.value30d.valuation.window.label`,
				'"30d"',
				row.value30d.valuation.window.label,
			);
		}
	});
}

/** A listings page for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseListingsPage(
	page: ListingsPage,
	field: string,
): Record<string, unknown> {
	const wire = {
		set: page.set,
		verdict: page.verdict,
		market: toWire(page.market, `${field}.market`),
		index: toWire(page.index, `${field}.index`),
		counts: page.counts,
		rows: page.rows.map((r, i) => serialiseRow(r, `${field}.rows[${i}]`)),
		next: page.next,
	};
	parseListingsPage(wire, field);
	return wire;
}

function parseRow(wire: unknown, field: string): ListingRow {
	const w = parseObject(wire, field);
	return {
		listing: parseListingAsk(w.listing, `${field}.listing`),
		circuit: parseCircuitRef(w.circuit, `${field}.circuit`),
		multiplier: parseMultiplier(w.multiplier, `${field}.multiplier`),
		check: parseStoredCheck(w.check, `${field}.check`),
		value30d: parseValue30d(w.value30d, `${field}.value30d`),
	};
}

function serialiseRow(row: ListingRow, field: string): Record<string, unknown> {
	const { value30d } = row;
	return {
		listing: serialiseListingAsk(row.listing, `${field}.listing`),
		circuit: toWire(row.circuit, `${field}.circuit`),
		multiplier: row.multiplier,
		check: serialiseStoredCheck(row.check, `${field}.check`),
		value30d:
			value30d.state === "shown"
				? {
						state: value30d.state,
						valuation: serialiseValuation(
							value30d.valuation,
							`${field}.value30d.valuation`,
						),
					}
				: value30d,
	};
}

function parseValue30d(wire: unknown, field: string): ListingRow["value30d"] {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"shown",
		"not-mining",
		"not-read",
	] as const);
	switch (state) {
		case "not-mining":
			return { state };
		case "not-read":
			return { state, detail: parseText(w.detail, `${field}.detail`) };
		case "shown":
			return {
				state,
				valuation: parseValuation(w.valuation, `${field}.valuation`),
			};
	}
}

function parseIndex(wire: unknown, field: string): Originality["index"] {
	const w = parseObject(wire, field);
	const circuitsChecked = parseUint(
		w.circuitsChecked,
		`${field}.circuitsChecked`,
	);
	if (circuitsChecked === 0n) {
		throw new ContractParseError(
			`${field}.circuitsChecked`,
			"at least one circuit checked",
			circuitsChecked,
		);
	}
	const upTo = parseObject(w.upToBlock, `${field}.upToBlock`);
	if (upTo.chainId !== 56) {
		throw new ContractParseError(
			`${field}.upToBlock.chainId`,
			"56 (the index is BNB Chain's circuits)",
			upTo.chainId,
		);
	}
	return {
		circuitsChecked,
		upToBlock: {
			chainId: 56,
			block: parseUint(upTo.block, `${field}.upToBlock.block`),
		},
	};
}
