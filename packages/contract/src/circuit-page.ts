// The result page's response (docs/data-contract.md, "API responses"; approved 21 Nov 2026 in
// docs/decisions/2026-11-21-api-endpoints.md): one circuit's stored result, whether it was published,
// and the live reads behind its value and options. Every part is an existing contract shape; this
// parser also refuses a page whose parts are about different circuits or contradict each other.

import {
	type ListingAsk,
	type Multiplier,
	type Published,
	parseListingAsk,
	parseMultiplier,
	parsePublished,
	parseStoredCheck,
	type StoredCheck,
	sameWire,
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

/** A result page: a BNB Chain circuit's, or a FabX circuit's on X Layer (2026-11-26-fabx-circuit-page.md). */
export type CircuitPage = BnbCircuitPage | FabxCircuitPage;

/** A TapeOut circuit on BNB Chain: its result, and the live reads behind its value and options. */
export interface BnbCircuitPage {
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
		/** An active miner in the unverified pool (2026-11-21-circuit-page-reads.md). */
		| { state: "not-valued"; reason: string }
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

/**
 * A circuit on FabX's processor on X Layer: its result, whether it was published, FabX's stored
 * miner record and FabX's state. FabX isn't valued, so there is no value, payback or offer
 * (2026-11-25-fabx-copy-check.md, decision 8).
 */
export interface FabxCircuitPage {
	/** chainId 196. */
	circuit: CircuitRef;
	check: StoredCheck;
	published: Published;
	/** FabX's stored miner record; null when the circuit isn't a FabX miner. */
	miner: { taskId: number; readAtBlock: bigint } | null;
	fabx: {
		/** FabX's mining contract, from CLAUDE.md's On-chain facts. */
		contract: Address;
		/** The X Layer block FabX's history is stored up to. */
		followedTo: bigint;
		/** The block of a change to FabX's contract nobody has reviewed; null when not frozen. */
		frozenAtBlock: bigint | null;
	};
}

export function isFabxPage(page: CircuitPage): page is FabxCircuitPage {
	return "fabx" in page;
}

export function parseCircuitPage(wire: unknown, field: string): CircuitPage {
	const w = parseObject(wire, field);
	const circuit = parseCircuitRef(w.circuit, `${field}.circuit`);
	return "fabx" in w
		? parseFabxPage(w, circuit, field)
		: parseBnbPage(w, circuit, field);
}

function parseBnbPage(
	w: Record<string, unknown>,
	circuit: CircuitRef,
	field: string,
): BnbCircuitPage {
	if (circuit.chainId !== 56) {
		throw new ContractParseError(
			`${field}.circuit.chainId`,
			"56 on a BNB Chain page",
			circuit.chainId,
		);
	}
	const options = parseObject(w.options, `${field}.options`);
	const page: BnbCircuitPage = {
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

function parseFabxPage(
	w: Record<string, unknown>,
	circuit: CircuitRef,
	field: string,
): FabxCircuitPage {
	if (circuit.chainId !== 196) {
		throw new ContractParseError(
			`${field}.circuit.chainId`,
			"196 on a FabX page",
			circuit.chainId,
		);
	}
	const fabx = parseObject(w.fabx, `${field}.fabx`);
	const page: FabxCircuitPage = {
		circuit,
		check: parseStoredCheck(w.check, `${field}.check`),
		published: parsePublished(w.published, `${field}.published`),
		miner: w.miner === null ? null : parseFabxMiner(w.miner, `${field}.miner`),
		fabx: {
			contract: parseAddress(fabx.contract, `${field}.fabx.contract`),
			followedTo: parseUint(fabx.followedTo, `${field}.fabx.followedTo`),
			frozenAtBlock:
				fabx.frozenAtBlock === null
					? null
					: parseUint(fabx.frozenAtBlock, `${field}.fabx.frozenAtBlock`),
		},
	};
	checkFabxResult(page, field);
	checkPublished(page, field);
	return page;
}

function parseFabxMiner(
	wire: unknown,
	field: string,
): NonNullable<FabxCircuitPage["miner"]> {
	const w = parseObject(wire, field);
	const taskId = w.taskId;
	if (
		typeof taskId !== "number" ||
		!Number.isSafeInteger(taskId) ||
		taskId < 0
	) {
		throw new ContractParseError(`${field}.taskId`, "a task number", taskId);
	}
	return {
		taskId,
		readAtBlock: parseUint(w.readAtBlock, `${field}.readAtBlock`),
	};
}

/**
 * A FabX page's result is this circuit's, names FabX's mining contract when it is a miner's, and is
 * a miner's exactly when the page has FabX's miner record. FabX's market isn't read, so no FabX
 * result is "listed".
 */
function checkFabxResult(page: FabxCircuitPage, field: string): void {
	const { check, circuit, miner, fabx } = page;
	if (check.state !== "checked") return;
	const o = check.originality;
	if (!sameWire(o.circuit, circuit)) {
		throw new ContractParseError(
			`${field}.check.originality.circuit`,
			`this page's circuit (${circuit.processor} #${circuit.tokenId})`,
			`${o.circuit.processor} #${o.circuit.tokenId}`,
		);
	}
	if (o.scope === "listed") {
		throw new ContractParseError(
			`${field}.check.originality.scope`,
			'"miner" or "pasted" on a FabX page',
			o.scope,
		);
	}
	if (
		o.mining &&
		(o.mining.chainId !== 196 || o.mining.contract !== fabx.contract)
	) {
		throw new ContractParseError(
			`${field}.check.originality.mining`,
			`FabX's mining contract (${fabx.contract})`,
			`${o.mining.contract} on chain ${o.mining.chainId}`,
		);
	}
	if ((o.scope === "miner") !== (miner !== null)) {
		throw new ContractParseError(
			`${field}.miner`,
			o.scope === "miner"
				? "FabX's miner record for a miner's result"
				: "null for a circuit that isn't a miner",
			miner === null ? "null" : `task ${miner.taskId}`,
		);
	}
}

/**
 * An active miner has a value, over 30 days and to the 2030 halving, or in the unverified pool is
 * "not valued yet"; nothing else has one.
 */
function checkValue(page: BnbCircuitPage, field: string): void {
	const active = page.miner?.status === "active";
	if (active === (page.hold.state === "not-mining")) {
		throw new ContractParseError(
			`${field}.hold`,
			active
				? "a value for an active miner"
				: "not-mining for a circuit that isn't mining now",
			page.hold.state,
		);
	}
	if (page.hold.state === "not-valued" && page.miner?.pool !== "unverified") {
		throw new ContractParseError(
			`${field}.hold`,
			"a value: only the unverified pool is not valued yet",
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
function checkPayback(page: BnbCircuitPage, field: string): void {
	const { payback, listing } = page;
	const active = page.miner?.status === "active";
	if (active === (payback.state === "not-mining")) {
		throw new ContractParseError(
			`${field}.payback.state`,
			active ? "a payback state for an active miner" : '"not-mining"',
			payback.state,
		);
	}
	if ((page.hold.state === "not-valued") !== (payback.state === "not-valued")) {
		throw new ContractParseError(
			`${field}.payback.state`,
			page.hold.state === "not-valued"
				? '"not-valued", as the value is'
				: "a payback state for a valued miner",
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
function checkPublished(
	page: Pick<CircuitPage, "check" | "published">,
	field: string,
): void {
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
function checkVoucher(page: BnbCircuitPage, field: string): void {
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
function checkOneCircuit(page: BnbCircuitPage, field: string): void {
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

/** A circuit page for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseCircuitPage(
	page: CircuitPage,
	field: string,
): Record<string, unknown> {
	const wire = isFabxPage(page) ? fabxWire(page, field) : bnbWire(page, field);
	parseCircuitPage(wire, field);
	return wire;
}

function fabxWire(page: FabxCircuitPage, field: string) {
	return {
		circuit: toWire(page.circuit, `${field}.circuit`),
		check: serialiseStoredCheck(page.check, `${field}.check`),
		published: serialisePublished(page.published, `${field}.published`),
		miner: page.miner && toWire(page.miner, `${field}.miner`),
		fabx: toWire(page.fabx, `${field}.fabx`),
	};
}

function bnbWire(page: BnbCircuitPage, field: string) {
	return {
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
				: page.hold.state === "not-valued"
					? { state: page.hold.state, reason: page.hold.reason }
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
}

function parseVoucher(
	wire: unknown,
	field: string,
): NonNullable<BnbCircuitPage["voucher"]> {
	const w = parseObject(wire, field);
	return {
		voucherId: parseUint(w.voucherId, `${field}.voucherId`),
		holder: parseAddress(w.holder, `${field}.holder`),
		readAt: parseChainRead(w.readAt, `${field}.readAt`, 196),
	};
}

function parseHold(wire: unknown, field: string): BnbCircuitPage["hold"] {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, [
		"shown",
		"not-valued",
		"not-mining",
	] as const);
	if (state === "not-mining") return { state };
	if (state === "not-valued") {
		return { state, reason: parseText(w.reason, `${field}.reason`) };
	}
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
): BnbCircuitPage["options"]["lend"] {
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
	}) as BnbCircuitPage["options"]["lend"];
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
): BnbCircuitPage["bemPrice"] {
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
