// The result page's response (docs/data-contract.md, "API responses"; approved 21 Nov 2026 in
// docs/decisions/2026-11-21-api-endpoints.md): one circuit's stored result, whether it was published,
// and the live reads behind its value and options. Every part is an existing contract shape; this
// parser also refuses a page whose parts are about different circuits or contradict each other.

import {
	type ListingAsk,
	type Published,
	parseListingAsk,
	parsePublished,
	parseStoredCheck,
	type StoredCheck,
	serialiseListingAsk,
	serialisePublished,
	serialiseStoredCheck,
	toWire,
} from "./api-shared.ts";
import {
	type BemPrice,
	parseBemPrice,
	serialiseBemPrice,
} from "./bem-price.ts";
import { ContractParseError } from "./errors.ts";
import { type Miner, parseMiner, serialiseMiner } from "./miner.ts";
import {
	type ChainRead,
	type Offer,
	parseChainRead,
	parseOffer,
	serialiseOffer,
} from "./offer.ts";
import { type CircuitRef, parseCircuitRef } from "./originality.ts";
import { type Payback, parsePayback, serialisePayback } from "./payback.ts";
import {
	parseValuation,
	serialiseValuation,
	type Valuation,
} from "./valuation.ts";
import {
	type Address,
	type Hex32,
	parseAddress,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
} from "./wire.ts";

/** The two eligible processors' multipliers, and 0 for every other; the sealed mining contract can't add one. */
export const MULTIPLIERS = [0, 1, 6] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];

export interface CircuitPage {
	circuit: CircuitRef;
	multiplier: Multiplier;
	check: StoredCheck;
	published: Published;
	/** Live read; null when the circuit has never started mining. */
	miner: Miner | null;
	/** Its open listing on TapeOut's BNB market, if any. */
	listing: ListingAsk | null;
	/** When the rig vault holds it, read on X Layer. */
	voucher: { voucherId: bigint; holder: Address; readAt: ChainRead } | null;
	hold:
		| { state: "shown"; thirtyDays: Valuation; toHalving: Valuation }
		| { state: "not-mining" };
	payback: Payback;
	options: {
		sell: Extract<Offer, { option: "sell" }>;
		/** 7 days, then 14. */
		lend: [
			Extract<Offer, { option: "lend" }>,
			Extract<Offer, { option: "lend" }>,
		];
		rent: Extract<Offer, { option: "rent" }>;
	};
	bemPrice: BemPrice | { state: "no-price"; reason: string };
}

export function parseCircuitPage(wire: unknown, field: string): CircuitPage {
	const w = parseObject(wire, field);
	const circuit = parseCircuitRef(w.circuit, `${field}.circuit`);
	const options = parseObject(w.options, `${field}.options`);
	const page: CircuitPage = {
		circuit,
		multiplier: parseMultiplier(w.multiplier, `${field}.multiplier`),
		check: parseStoredCheck(w.check, `${field}.check`),
		published: parsePublished(w.published, `${field}.published`),
		miner: w.miner === null ? null : parseMiner(w.miner, `${field}.miner`),
		listing:
			w.listing === null
				? null
				: parseListingAsk(w.listing, `${field}.listing`),
		voucher:
			w.voucher === null ? null : parseVoucher(w.voucher, `${field}.voucher`),
		hold: parseHold(w.hold, `${field}.hold`),
		payback: parsePayback(w.payback, `${field}.payback`),
		options: {
			sell: parseOption(options.sell, `${field}.options.sell`, "sell"),
			lend: parseLend(options.lend, `${field}.options.lend`),
			rent: parseOption(options.rent, `${field}.options.rent`, "rent"),
		},
		bemPrice: parsePageBemPrice(w.bemPrice, `${field}.bemPrice`),
	};
	checkOneCircuit(page, field);
	checkValue(page, field);
	checkPayback(page, field);
	checkPublished(page, field);
	checkVoucher(page, field);
	return page;
}

/** An active miner always has a value, over 30 days and to the 2030 halving; nothing else has one. */
function checkValue(page: CircuitPage, field: string): void {
	const active = page.miner?.status === "active";
	if (active !== (page.hold.state === "shown")) {
		throw new ContractParseError(
			`${field}.hold`,
			active
				? "a value for an active miner"
				: "not-mining for a circuit that isn't mining now",
			page.hold.state,
		);
	}
	if (page.hold.state === "shown") {
		const windows = [
			["thirtyDays", page.hold.thirtyDays, "30d"],
			["toHalving", page.hold.toHalving, "to-2030-halving"],
		] as const;
		for (const [part, valuation, label] of windows) {
			if (valuation.window.label !== label) {
				throw new ContractParseError(
					`${field}.hold.${part}.window.label`,
					`"${label}"`,
					valuation.window.label,
				);
			}
		}
	}
}

/** Payback is for this page's own buyable listing, at its asking price, and only for an active miner. */
function checkPayback(page: CircuitPage, field: string): void {
	const { payback, listing } = page;
	const active = page.miner?.status === "active";
	if (active === (payback.state === "not-mining")) {
		throw new ContractParseError(
			`${field}.payback.state`,
			active ? "a payback state for an active miner" : '"not-mining"',
			payback.state,
		);
	}
	if (active && listing?.buyable && payback.state === "not-listed") {
		throw new ContractParseError(
			`${field}.payback.state`,
			`a payback for buyable listing ${listing.listingId}`,
			payback.state,
		);
	}
	if (payback.state !== "shown") return;
	if (!listing?.buyable) {
		throw new ContractParseError(
			`${field}.payback`,
			"a buyable listing on this page to pay back",
			listing ? "a listing that isn't buyable" : "no listing",
		);
	}
	if (payback.listingId !== listing.listingId) {
		throw new ContractParseError(
			`${field}.payback.listingId`,
			`this page's listing (${listing.listingId})`,
			payback.listingId,
		);
	}
	if (
		payback.ask.currency !== listing.ask.currency ||
		payback.ask.value !== listing.ask.value
	) {
		throw new ContractParseError(
			`${field}.payback.ask`,
			`the listing's ask (${listing.ask.value} ${listing.ask.currency})`,
			`${payback.ask.value} ${payback.ask.currency}`,
		);
	}
}

/** Only miners and listed circuits are published; a pasted result never is, and only a stored result can be current. */
function checkPublished(page: CircuitPage, field: string): void {
	const { published, check } = page;
	const scope = check.state === "checked" ? check.originality.scope : null;
	if (published.state !== "not-published") {
		if (scope === null || scope === "pasted") {
			throw new ContractParseError(
				`${field}.published`,
				"not-published for a result that is pasted or not stored",
				published.state,
			);
		}
		return;
	}
	if (
		scope !== null &&
		(published.reason === "pasted") !== (scope === "pasted")
	) {
		throw new ContractParseError(
			`${field}.published.reason`,
			scope === "pasted" ? '"pasted"' : `"not-yet" for a ${scope} result`,
			published.reason,
		);
	}
}

/** Lend names this page's RIG voucher, or says there isn't one. */
function checkVoucher(page: CircuitPage, field: string): void {
	page.options.lend.forEach((offer, i) => {
		const named =
			offer.state === "live"
				? offer.voucherId
				: offer.reason.kind === "not-a-voucher"
					? null
					: offer.reason.voucherId;
		const expected = page.voucher?.voucherId ?? null;
		if (named !== expected) {
			throw new ContractParseError(
				`${field}.options.lend[${i}].reason`,
				expected === null
					? "not-a-voucher: the page has no RIG voucher"
					: `RIG voucher ${expected}`,
				named === null ? "not-a-voucher" : `voucher ${named}`,
			);
		}
	});
}

/** Every part is about this page's circuit: the stored result, the miner read, and every miner key. */
function checkOneCircuit(page: CircuitPage, field: string): void {
	const { check, circuit, miner } = page;
	if (
		check.state === "checked" &&
		!sameWire(check.originality.circuit, circuit)
	) {
		throw new ContractParseError(
			`${field}.check.originality.circuit`,
			`this page's circuit (${circuit.processor} #${circuit.tokenId})`,
			`${check.originality.circuit.processor} #${check.originality.circuit.tokenId}`,
		);
	}
	if (
		miner &&
		(miner.processor !== circuit.processor || miner.tokenId !== circuit.tokenId)
	) {
		throw new ContractParseError(
			`${field}.miner`,
			`a read of this page's circuit (${circuit.processor} #${circuit.tokenId})`,
			`${miner.processor} #${miner.tokenId}`,
		);
	}
	// The payback always names the miner key, mining or not; every other part must agree with it
	const key = miner?.key ?? page.payback.minerKey;
	const keyed: [string, Hex32][] = [
		["payback", page.payback.minerKey],
		["options.sell", page.options.sell.minerKey],
		["options.lend[0]", page.options.lend[0].minerKey],
		["options.lend[1]", page.options.lend[1].minerKey],
		["options.rent", page.options.rent.minerKey],
	];
	if (page.hold.state === "shown") {
		keyed.push(
			["hold.thirtyDays", page.hold.thirtyDays.minerKey],
			["hold.toHalving", page.hold.toHalving.minerKey],
		);
	}
	for (const [part, partKey] of keyed) {
		if (partKey !== key) {
			throw new ContractParseError(
				`${field}.${part}.minerKey`,
				`this circuit's miner key (${key})`,
				partKey,
			);
		}
	}
}

function sameWire(a: unknown, b: unknown): boolean {
	return JSON.stringify(toWire(a, "")) === JSON.stringify(toWire(b, ""));
}

/** A circuit page for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseCircuitPage(
	page: CircuitPage,
	field: string,
): Record<string, unknown> {
	const wire = {
		circuit: toWire(page.circuit, `${field}.circuit`),
		multiplier: page.multiplier,
		check: serialiseStoredCheck(page.check, `${field}.check`),
		published: serialisePublished(page.published, `${field}.published`),
		miner: page.miner && serialiseMiner(page.miner, `${field}.miner`),
		listing:
			page.listing && serialiseListingAsk(page.listing, `${field}.listing`),
		voucher: page.voucher && toWire(page.voucher, `${field}.voucher`),
		hold:
			page.hold.state === "not-mining"
				? { state: page.hold.state }
				: {
						state: page.hold.state,
						thirtyDays: serialiseValuation(
							page.hold.thirtyDays,
							`${field}.hold.thirtyDays`,
						),
						toHalving: serialiseValuation(
							page.hold.toHalving,
							`${field}.hold.toHalving`,
						),
					},
		payback: serialisePayback(page.payback, `${field}.payback`),
		options: {
			sell: serialiseOffer(page.options.sell, `${field}.options.sell`),
			lend: page.options.lend.map((o, i) =>
				serialiseOffer(o, `${field}.options.lend[${i}]`),
			),
			rent: serialiseOffer(page.options.rent, `${field}.options.rent`),
		},
		bemPrice:
			"state" in page.bemPrice
				? { state: page.bemPrice.state, reason: page.bemPrice.reason }
				: serialiseBemPrice(page.bemPrice, `${field}.bemPrice`),
	};
	parseCircuitPage(wire, field);
	return wire;
}

function parseMultiplier(wire: unknown, field: string): Multiplier {
	if (!(MULTIPLIERS as readonly unknown[]).includes(wire)) {
		throw new ContractParseError(
			field,
			"6, 1 or 0 (the processor's multiplier in the mining contract)",
			wire,
		);
	}
	return wire as Multiplier;
}

function parseVoucher(
	wire: unknown,
	field: string,
): NonNullable<CircuitPage["voucher"]> {
	const w = parseObject(wire, field);
	return {
		voucherId: parseUint(w.voucherId, `${field}.voucherId`),
		holder: parseAddress(w.holder, `${field}.holder`),
		readAt: parseChainRead(w.readAt, `${field}.readAt`, 196),
	};
}

function parseHold(wire: unknown, field: string): CircuitPage["hold"] {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"shown",
		"not-mining",
	] as const);
	if (state === "not-mining") return { state };
	return {
		state,
		thirtyDays: parseValuation(w.thirtyDays, `${field}.thirtyDays`),
		toHalving: parseValuation(w.toHalving, `${field}.toHalving`),
	};
}

function parseOption<O extends "sell" | "rent">(
	wire: unknown,
	field: string,
	option: O,
): Extract<Offer, { option: O }> {
	const offer = parseOffer(wire, field);
	if (offer.option !== option) {
		throw new ContractParseError(
			`${field}.option`,
			`"${option}"`,
			offer.option,
		);
	}
	return offer as Extract<Offer, { option: O }>;
}

function parseLend(
	wire: unknown,
	field: string,
): CircuitPage["options"]["lend"] {
	if (!Array.isArray(wire) || wire.length !== 2) {
		throw new ContractParseError(
			field,
			"two Lend offers, 7 days then 14",
			wire,
		);
	}
	const [seven, fourteen] = wire.map((o, i) => {
		const offer = parseOffer(o, `${field}[${i}]`);
		if (offer.option !== "lend") {
			throw new ContractParseError(
				`${field}[${i}].option`,
				'"lend"',
				offer.option,
			);
		}
		return offer;
	}) as CircuitPage["options"]["lend"];
	if (seven.termDays !== 7 || fourteen.termDays !== 14) {
		throw new ContractParseError(
			field,
			"the 7-day offer, then the 14-day offer",
			[seven.termDays, fourteen.termDays],
		);
	}
	return [seven, fourteen];
}

function parsePageBemPrice(
	wire: unknown,
	field: string,
): CircuitPage["bemPrice"] {
	const w = parseObject(wire, field);
	if ("state" in w) {
		parseOneOf(w.state, `${field}.state`, ["no-price"] as const);
		return {
			state: "no-price",
			reason: parseText(w.reason, `${field}.reason`),
		};
	}
	return parseBemPrice(w, field);
}
