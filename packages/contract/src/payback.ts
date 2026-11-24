// Payback: days until the miner's own asking price is earned back, for each case
// (docs/decisions/2026-11-20-payback-and-bem-price.md). Missing is a state, never a number of days.

import {
	type BemPrice,
	parseBemPrice,
	serialiseBemPrice,
} from "./bem-price.ts";
import { type BnbRead, parseBnbRead, serialiseBnbRead } from "./bnb.ts";
import { ContractParseError } from "./errors.ts";
import { type Amount, parseAmount } from "./offer.ts";
import {
	parseScenario,
	parseValuationInputs,
	parseValuationModel,
	type Scenario,
	serialiseScenario,
	serialiseValuationInputs,
	serialiseValuationModel,
	type Valuation,
} from "./valuation.ts";
import {
	type Hex32,
	parseHex32,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
	serialiseUint,
} from "./wire.ts";

const ONE_BEM = 10n ** 8n;

export type Payback =
	| {
			state: "shown";
			minerKey: Hex32;
			/** The miner's open, buyable listing on TapeOut's BNB market. */
			listingId: bigint;
			/** BNB: what the buyer pays. */
			ask: Amount;
			bemPrice: BemPrice;
			/** The ask in BEM base units at bemPrice, rounded up. */
			askInBem: bigint;
			/** Whole days from readAt; null = not earned back by the 2030 halving. low ≥ base ≥ high. */
			days: Scenario<bigint | null>;
			inputs: Valuation["inputs"];
			readAt: BnbRead;
			model: Valuation["model"];
	  }
	| { state: "not-listed"; minerKey: Hex32; readAt: BnbRead }
	| { state: "not-mining"; minerKey: Hex32; readAt: BnbRead }
	| { state: "no-price"; minerKey: Hex32; reason: string; readAt: BnbRead }
	/** An active miner the engine doesn't value yet: the unverified pool (2026-11-21-circuit-page-reads.md). */
	| { state: "not-valued"; minerKey: Hex32; reason: string; readAt: BnbRead };

const STATES = [
	"shown",
	"not-listed",
	"not-mining",
	"no-price",
	"not-valued",
] as const;

export function parsePayback(wire: unknown, field: string): Payback {
	const w = parseObject(wire, field);
	const state = parseOneOf(w.state, `${field}.state`, STATES);
	const minerKey = parseHex32(w.minerKey, `${field}.minerKey`);
	const readAt = parseBnbRead(w.readAt, `${field}.readAt`);
	switch (state) {
		case "not-listed":
		case "not-mining":
			return { state, minerKey, readAt };
		case "no-price":
		case "not-valued":
			return {
				state,
				minerKey,
				reason: parseText(w.reason, `${field}.reason`),
				readAt,
			};
		case "shown":
			return parseShown(w, field, minerKey, readAt);
	}
}

function parseShown(
	w: Record<string, unknown>,
	field: string,
	minerKey: Hex32,
	readAt: BnbRead,
): Payback {
	const ask = parseAmount(w.ask, `${field}.ask`, {
		only: "BNB",
		positive: true,
	});
	const bemPrice = parseBemPrice(w.bemPrice, `${field}.bemPrice`);
	// The miner, the network, the listing and the price are all read at one block
	if (bemPrice.readAt.block !== readAt.block) {
		throw new ContractParseError(
			`${field}.bemPrice.readAt.block`,
			`the payback's block (${readAt.block})`,
			bemPrice.readAt.block,
		);
	}
	const askInBem = parseUint(w.askInBem, `${field}.askInBem`);
	const expected = ceilDiv(ask.value * ONE_BEM, bemPrice.bnbPerBem);
	if (askInBem !== expected) {
		throw new ContractParseError(
			`${field}.askInBem`,
			`the ask at the stated price, rounded up (${expected})`,
			askInBem,
		);
	}
	const days = parseScenario(w.days, `${field}.days`, parseDays);
	checkDaysOrder(days, `${field}.days`);
	return {
		state: "shown",
		minerKey,
		listingId: parseUint(w.listingId, `${field}.listingId`),
		ask,
		bemPrice,
		askInBem,
		days,
		inputs: parseValuationInputs(w.inputs, `${field}.inputs`),
		readAt,
		model: parseValuationModel(w.model, `${field}.model`),
	};
}

/** A day count of 1 or more, or null: not earned back by the 2030 halving. */
function parseDays(wire: unknown, field: string): bigint | null {
	if (wire === null) return null;
	const days = parseUint(wire, field);
	if (days === 0n) {
		throw new ContractParseError(field, "day 1 or later, or null", days);
	}
	return days;
}

/** Low is the longest payback: low ≥ base ≥ high, with null (never, by the halving) the longest. */
function checkDaysOrder(days: Scenario<bigint | null>, field: string): void {
	const atLeast = (a: bigint | null, b: bigint | null) =>
		a === null || (b !== null && a >= b);
	if (!atLeast(days.low, days.base) || !atLeast(days.base, days.high)) {
		throw new ContractParseError(
			field,
			"low ≥ base ≥ high, with null the longest",
			`${days.low} · ${days.base} · ${days.high}`,
		);
	}
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

/** A payback for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialisePayback(
	payback: Payback,
	field: string,
): Record<string, unknown> {
	const base = {
		state: payback.state,
		minerKey: payback.minerKey,
	};
	const readAt = serialiseBnbRead(payback.readAt, `${field}.readAt`);
	let wire: Record<string, unknown>;
	switch (payback.state) {
		case "not-listed":
		case "not-mining":
			wire = { ...base, readAt };
			break;
		case "no-price":
		case "not-valued":
			wire = { ...base, reason: payback.reason, readAt };
			break;
		case "shown":
			wire = {
				...base,
				listingId: serialiseUint(payback.listingId, `${field}.listingId`),
				ask: {
					currency: payback.ask.currency,
					value: serialiseUint(payback.ask.value, `${field}.ask.value`),
				},
				bemPrice: serialiseBemPrice(payback.bemPrice, `${field}.bemPrice`),
				askInBem: serialiseUint(payback.askInBem, `${field}.askInBem`),
				days: serialiseScenario(payback.days, `${field}.days`, (d, at) =>
					d === null ? null : serialiseUint(d, at),
				),
				inputs: serialiseValuationInputs(payback.inputs, `${field}.inputs`),
				readAt,
				model: serialiseValuationModel(payback.model, `${field}.model`),
			};
	}
	parsePayback(wire, field);
	return wire;
}
