// The live listings page (docs/data-contract.md, ListingsPage; docs/decisions/2026-11-21-api-endpoints.md):
// every open listing on TapeOut's BNB market as the market follow last read it, each with its stored
// result and a 30-day value from the weight stored with the listing, valued against the network the
// follow stored at the same block (2026-11-22-market-network.md). No live reads. A page is whole or
// an error, and it goes through the contract's own parser before it is returned.

import { minerKey, PROCESSOR_MULTIPLIERS } from "@foreman/chain-bnb";
import {
	type ApiError,
	LISTING_VERDICTS,
	LISTINGS_PAGE_SIZE,
	type ListingRow,
	type ListingsPage,
	type ListingVerdict,
	type NetworkState,
	parseListingsPage,
	type StoredCheck,
	serialiseListingsPage,
} from "@foreman/contract";
import {
	marketRead,
	type OpenListing,
	readCircuitRef,
	readMarketNetwork,
	readNetworkDays,
	readOpenListings,
	readResultsIndex,
	readStoredResult,
} from "@foreman/index";
import { type DailySample, valueMiner } from "@foreman/valuation";
import type pg from "pg";
import { NOT_VALUED_REASON } from "./circuit-page.ts";

export interface ListingsQuery {
	set: ListingsPage["set"];
	verdict: ListingVerdict | null;
	/** The `next` of the page before, or null for the first page. */
	cursor: string | null;
}

export type ListingsRead =
	| { ok: true; page: ListingsPage }
	| { ok: false; error: ApiError };

/** A listing whose circuit has no stored result yet: "Can't check" on screen, never a verdict. */
export const NOT_CHECKED = "Foreman hasn't checked this circuit yet";

export async function readListingsPage(
	pool: pg.Pool,
	query: ListingsQuery,
): Promise<ListingsRead> {
	const after = query.cursor === null ? null : parseCursor(query.cursor);
	if (after === undefined) {
		return {
			ok: false,
			error: {
				error: "not-recognised",
				detail: "That isn't a page cursor from this API",
				accepted: ["the next value of the page before"],
			},
		};
	}
	let at: Awaited<ReturnType<typeof marketRead>>;
	let network: NetworkState | null;
	let index: Awaited<ReturnType<typeof readResultsIndex>>;
	try {
		[at, network, index] = await Promise.all([
			marketRead(pool),
			readMarketNetwork(pool),
			readResultsIndex(pool),
		]);
	} catch (error) {
		return notReady(plain(error));
	}
	if (!network || network.readAt.block !== at.block) {
		return notReady(
			"The network hasn't been stored at the market's block yet: run the follow",
		);
	}
	if (!index) return notReady("No stored results yet: run the results job");

	try {
		const [open, days] = await Promise.all([
			readOpenListings(pool),
			readNetworkDays(pool),
		]);
		const mining = open.filter(isMining);
		const inSet = query.set === "mining" ? mining : open;
		const byVerdict = Object.fromEntries(
			LISTING_VERDICTS.map((v) => [v, 0]),
		) as Record<ListingVerdict, number>;
		for (const l of inSet) byVerdict[verdictOf(l)]++;

		const shown = inSet.filter(
			(l) =>
				(query.verdict === null || verdictOf(l) === query.verdict) &&
				(after === null || comesAfter(after, l)),
		);
		const slice = shown.slice(0, LISTINGS_PAGE_SIZE);
		const last = slice.at(-1);
		const rows: ListingRow[] = [];
		for (const l of slice) rows.push(await row(pool, l, network, days));

		const page: ListingsPage = {
			set: query.set,
			verdict: query.verdict,
			market: { venue: "bnb-market", upTo: at },
			index,
			counts: {
				open: open.length,
				buyable: open.filter((l) => l.ask.buyable).length,
				sellers: new Set(open.map((l) => l.ask.seller)).size,
				bySet: { mining: mining.length, all: open.length },
				byVerdict,
			},
			rows,
			next: shown.length > LISTINGS_PAGE_SIZE && last ? cursorOf(last) : null,
		};
		return {
			ok: true,
			page: parseListingsPage(serialiseListingsPage(page, "page"), "page"),
		};
	} catch (error) {
		return {
			ok: false,
			error: { error: "read-failed", detail: plain(error) },
		};
	}
}

/** The mining set: listings that can be bought now, whose miner is active (status 1). */
function isMining(l: OpenListing): boolean {
	return l.ask.buyable && l.miner?.status === 1;
}

function verdictOf(l: OpenListing): ListingVerdict {
	const kind = l.kind as ListingVerdict | null;
	if (kind === null) return "not-checked";
	if (!LISTING_VERDICTS.includes(kind)) {
		throw new Error(
			`Listing ${l.ask.listingId}: unknown stored verdict ${kind}`,
		);
	}
	return kind;
}

async function row(
	pool: pg.Pool,
	l: OpenListing,
	network: NetworkState,
	days: DailySample[],
): Promise<ListingRow> {
	const [circuit, stored] = await Promise.all([
		readCircuitRef(pool, l.circuit),
		readStoredResult(pool, l.circuit),
	]);
	if (!circuit) {
		throw new Error(
			`Listing ${l.ask.listingId}: circuit #${l.circuit.id} on ${l.circuit.processor} isn't in the index`,
		);
	}
	const check: StoredCheck = stored
		? { state: "checked", originality: stored.originality }
		: { state: "not-checked", detail: NOT_CHECKED };
	return {
		listing: l.ask,
		circuit,
		multiplier: PROCESSOR_MULTIPLIERS[l.circuit.processor] ?? 0,
		check,
		value30d: value30d(l, network, days),
	};
}

/** Hold over 30 days from the stored weight: an active verified miner only, never a made-up zero. */
function value30d(
	l: OpenListing,
	network: NetworkState,
	days: DailySample[],
): ListingRow["value30d"] {
	const m = l.miner;
	if (!m) {
		return {
			state: "not-read",
			detail:
				"Foreman hasn't read this listing's miner at the market's block yet",
		};
	}
	if (m.status !== 1) return { state: "not-mining" };
	if (m.taskId === 0) return { state: "not-valued", reason: NOT_VALUED_REASON };
	if (m.verifWeight === 0n) {
		throw new Error(
			`Listing ${l.ask.listingId}: the miner is mining with no weight in its pool`,
		);
	}
	return {
		state: "shown",
		valuation: valueMiner({
			miner: {
				key: minerKey(l.circuit),
				status: "active",
				pool: "verified",
				weight: m.verifWeight,
				weightWithoutBonus: m.weightWithoutBonus,
				readAt: m.readAt,
			},
			network,
			days,
			window: "30d",
		}),
	};
}

/** Pages follow the rows' order, newest listed first: a cursor is the last row's place in it. */
type Place = { block: bigint; listingId: bigint };

function cursorOf(l: OpenListing): string {
	return `${l.ask.listedAt.block}-${l.ask.listingId}`;
}

/** The place a cursor names, or undefined when it isn't one. */
function parseCursor(cursor: string): Place | undefined {
	const m = /^(\d{1,20})-(\d{1,78})$/.exec(cursor);
	if (!m?.[1] || !m[2]) return undefined;
	return { block: BigInt(m[1]), listingId: BigInt(m[2]) };
}

/** True when `l` comes after `place` in the page order: listed earlier, or in the same block with a lower id. */
function comesAfter(place: Place, l: OpenListing): boolean {
	const block = l.ask.listedAt.block;
	return (
		block < place.block ||
		(block === place.block && l.ask.listingId < place.listingId)
	);
}

function notReady(detail: string): ListingsRead {
	return { ok: false, error: { error: "not-ready", detail } };
}

function plain(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
