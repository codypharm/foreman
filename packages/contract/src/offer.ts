// Offer: what each option can actually get for a miner right now, by venue.
// Venues: docs/decisions/2026-11-19-offer-venues.md. Sell without bids:
// docs/decisions/2026-11-19-sell-without-bids.md. Shape: 2026-11-19-offer-shape.md.
// A missing offer is its own state, never an amount of zero. Hold is not an offer.

import { ContractParseError } from "./errors.ts";
import {
	type Hex32,
	parseHex32,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
	serialiseUint,
} from "./wire.ts";

export type Currency = "BNB" | "OKB" | "BEM";
/** An amount in a stated currency, in its base units: BNB and OKB 18 decimals, BEM 8. */
export interface Amount {
	currency: Currency;
	value: bigint;
}

export type Venue = "bnb-market" | "xlayer-market" | "tapepool";
/** Where and when an offer was read. Each venue lives on one chain. */
export interface ChainRead {
	chainId: 56 | 196;
	block: bigint;
	time: bigint;
}

/** One comparable miner's completed sale or open ask. */
export interface Comparable {
	price: Amount;
	/** The comparable miner's weight, so a price per unit of weight can be shown. Never 0. */
	weight: bigint;
	readAt: ChainRead;
	/** The sale's transaction; asks have none. */
	tx?: Hex32;
}

export interface Comparables {
	venue: Venue;
	/** How the comparable miners were picked, in words for the screen. Code, never a model. */
	rule: string;
	items: Comparable[];
}

export type SellBid =
	| {
			state: "live";
			venue: Venue;
			readAt: ChainRead;
			price: Amount;
			expiresAt: bigint | null;
	  }
	| { state: "none"; checkedAt: bigint };

export type Offer =
	| {
			option: "sell";
			minerKey: Hex32;
			bid: SellBid;
			sales: Comparables;
			asks: Comparables;
	  }
	| { option: "rent"; minerKey: Hex32; state: "no-venue" }
	| { option: "rent"; minerKey: Hex32; state: "none"; checkedAt: bigint }
	| {
			option: "lend";
			minerKey: Hex32;
			state: "live";
			venue: "tapepool";
			readAt: ChainRead;
			receivedNow: Amount;
			fee: Amount;
			termDays: 7 | 14;
			repayment: "from-output-until-paid";
	  }
	| { option: "lend"; minerKey: Hex32; state: "none"; checkedAt: bigint };

const CURRENCIES = ["BNB", "OKB", "BEM"] as const;
const VENUES = ["bnb-market", "xlayer-market", "tapepool"] as const;
const CHAIN_OF: Record<Venue, 56 | 196> = {
	"bnb-market": 56,
	"xlayer-market": 196,
	tapepool: 196,
};

export function parseOffer(wire: unknown, field: string): Offer {
	const w = parseObject(wire, field);
	const option = parseOneOf(w.option, `${field}.option`, [
		"sell",
		"rent",
		"lend",
	] as const);
	const minerKey = parseHex32(w.minerKey, `${field}.minerKey`);
	switch (option) {
		case "sell":
			return {
				option,
				minerKey,
				bid: parseBid(w.bid, `${field}.bid`),
				sales: parseComparables(w.sales, `${field}.sales`, true),
				asks: parseComparables(w.asks, `${field}.asks`, false),
			};
		case "rent": {
			// No rental venue exists, so there is no live rental shape to read (offer-venues ADR)
			const state = parseOneOf(w.state, `${field}.state`, [
				"no-venue",
				"none",
			] as const);
			return state === "no-venue"
				? { option, minerKey, state }
				: {
						option,
						minerKey,
						state,
						checkedAt: parseUint(w.checkedAt, `${field}.checkedAt`),
					};
		}
		case "lend": {
			const state = parseOneOf(w.state, `${field}.state`, [
				"live",
				"none",
			] as const);
			if (state === "none") {
				return {
					option,
					minerKey,
					state,
					checkedAt: parseUint(w.checkedAt, `${field}.checkedAt`),
				};
			}
			const venue = parseOneOf(w.venue, `${field}.venue`, [
				"tapepool",
			] as const);
			return {
				option,
				minerKey,
				state,
				venue,
				readAt: parseChainRead(w.readAt, `${field}.readAt`, CHAIN_OF[venue]),
				receivedNow: parseAmount(w.receivedNow, `${field}.receivedNow`, {
					only: "BEM",
					positive: true,
				}),
				fee: parseAmount(w.fee, `${field}.fee`, {
					only: "BEM",
					positive: false,
				}),
				termDays: parseTerm(w.termDays, `${field}.termDays`),
				repayment: parseOneOf(w.repayment, `${field}.repayment`, [
					"from-output-until-paid",
				] as const),
			};
		}
	}
}

function parseBid(wire: unknown, field: string): SellBid {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"live",
		"none",
	] as const);
	if (state === "none")
		return { state, checkedAt: parseUint(w.checkedAt, `${field}.checkedAt`) };
	const venue = parseOneOf(w.venue, `${field}.venue`, VENUES);
	return {
		state,
		venue,
		readAt: parseChainRead(w.readAt, `${field}.readAt`, CHAIN_OF[venue]),
		price: parseAmount(w.price, `${field}.price`, { positive: true }),
		expiresAt:
			w.expiresAt === null
				? null
				: parseUint(w.expiresAt, `${field}.expiresAt`),
	};
}

function parseComparables(
	wire: unknown,
	field: string,
	sales: boolean,
): Comparables {
	const w = parseObject(wire, field);
	const venue = parseOneOf(w.venue, `${field}.venue`, VENUES);
	const rule = parseText(w.rule, `${field}.rule`);
	if (!Array.isArray(w.items))
		throw new ContractParseError(`${field}.items`, "a list", w.items);
	const items = w.items.map((item, i) => {
		const at = `${field}.items[${i}]`;
		const x = parseObject(item, at);
		const weight = parseUint(x.weight, `${at}.weight`);
		if (weight === 0n) {
			throw new ContractParseError(`${at}.weight`, "a weight above 0", weight);
		}
		const comparable: Comparable = {
			price: parseAmount(x.price, `${at}.price`, { positive: true }),
			weight,
			readAt: parseChainRead(x.readAt, `${at}.readAt`, CHAIN_OF[venue]),
		};
		if (sales) comparable.tx = parseHex32(x.tx, `${at}.tx`);
		return comparable;
	});
	return { venue, rule, items };
}

function parseAmount(
	wire: unknown,
	field: string,
	options: { only?: Currency; positive: boolean },
): Amount {
	const w = parseObject(wire, field);
	const currency = options.only
		? parseOneOf(w.currency, `${field}.currency`, [options.only])
		: parseOneOf(w.currency, `${field}.currency`, CURRENCIES);
	const value = parseUint(w.value, `${field}.value`);
	if (options.positive && value === 0n) {
		throw new ContractParseError(
			`${field}.value`,
			"an amount above 0; a missing offer is state none",
			value,
		);
	}
	return { currency, value };
}

function parseChainRead(
	wire: unknown,
	field: string,
	chainId: 56 | 196,
): ChainRead {
	const w = parseObject(wire, field);
	if (w.chainId !== chainId) {
		throw new ContractParseError(
			`${field}.chainId`,
			`${chainId}, where this venue is`,
			w.chainId,
		);
	}
	return {
		chainId,
		block: parseUint(w.block, `${field}.block`),
		time: parseUint(w.time, `${field}.time`),
	};
}

/** TapePool's two terms. */
function parseTerm(wire: unknown, field: string): 7 | 14 {
	if (wire !== 7 && wire !== 14) {
		throw new ContractParseError(field, "7 or 14 (TapePool's terms)", wire);
	}
	return wire;
}

/** An offer for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseOffer(
	offer: Offer,
	field: string,
): Record<string, unknown> {
	const wire = toWire(offer) as Record<string, unknown>;
	parseOffer(wire, field);
	return wire;
}

/** bigints become decimal strings; everything else is already the wire shape. */
function toWire(value: unknown): unknown {
	if (typeof value === "bigint") return serialiseUint(value, "offer");
	if (Array.isArray(value)) return value.map(toWire);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, toWire(v)]),
		);
	}
	return value;
}
