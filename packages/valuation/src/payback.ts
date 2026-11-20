// Payback: the first whole day on which a miner's projected BEM reaches its own asking price, for
// each case, or never by the 2030 halving (docs/decisions/2026-11-20-payback-and-bem-price.md).
// Code, never a model. Unclaimed BEM is not counted: the seller can claim it before the sale.

import {
	type BemPrice,
	type BnbRead,
	type Hex32,
	type Payback,
	parsePayback,
	type Scenario,
	serialisePayback,
	type Valuation,
} from "@foreman/contract";
import { FIRST_HALVING } from "./emission.ts";
import { ValuationInputError } from "./errors.ts";
import { projectedOutput } from "./projection.ts";

const DAY = 86_400n;
const ONE_BEM = 10n ** 8n;

export interface PaybackInput {
	minerKey: Hex32;
	/** The block the miner, the network, the listing and the price were read at. */
	readAt: BnbRead;
	/** A mining miner carries its valuation's inputs, read at readAt. */
	miner:
		| { mining: false }
		| { mining: true; inputs: Valuation["inputs"]; model: Valuation["model"] };
	/** The miner's open, buyable listing on TapeOut's BNB market; null when there is none. */
	listing: { listingId: bigint; priceWei: bigint } | null;
	bemPrice:
		| { available: true; price: BemPrice }
		| { available: false; reason: string };
}

export function payback(input: PaybackInput): Payback {
	const { minerKey, readAt, miner, listing, bemPrice } = input;
	let result: Payback;
	if (!miner.mining) {
		result = { state: "not-mining", minerKey, readAt };
	} else if (listing === null) {
		result = { state: "not-listed", minerKey, readAt };
	} else if (!bemPrice.available) {
		result = { state: "no-price", minerKey, reason: bemPrice.reason, readAt };
	} else {
		const askInBem = ceilDiv(
			listing.priceWei * ONE_BEM,
			bemPrice.price.bnbPerBem,
		);
		const { inputs } = miner;
		const day = (c: "low" | "base" | "high") =>
			firstDayReaching(askInBem, {
				minerWeight: inputs.minerWeight[c].value,
				networkWeight: inputs.networkWeight.value,
				dailyGrowthPpm: inputs.growthPpm[c].value,
				from: readAt.time,
			});
		const days: Scenario<bigint | null> = {
			low: day("low"),
			base: day("base"),
			high: day("high"),
		};
		result = {
			state: "shown",
			minerKey,
			listingId: listing.listingId,
			ask: { currency: "BNB", value: listing.priceWei },
			bemPrice: bemPrice.price,
			askInBem,
			days,
			inputs,
			readAt,
			model: miner.model,
		};
	}
	// The contract's checks (one block, the ask in BEM, days in order) run on every payback
	return parsePayback(serialisePayback(result, "payback"), "payback");
}

/**
 * The first whole day d ≥ 1 on which the BEM projected over [from, from + d days) reaches
 * `target`, with the whole day before the 2030 halving; null if no such day. Output only grows
 * with d, so a binary search finds it.
 */
function firstDayReaching(
	target: bigint,
	p: {
		minerWeight: bigint;
		networkWeight: bigint;
		dailyGrowthPpm: bigint;
		from: bigint;
	},
): bigint | null {
	if (p.from >= FIRST_HALVING) {
		throw new ValuationInputError(
			`Payback is counted until the 2030 halving; the read at ${p.from} is after it`,
		);
	}
	const reached = (d: bigint) =>
		projectedOutput({ ...p, to: p.from + d * DAY }) >= target;
	let hi = (FIRST_HALVING - p.from) / DAY;
	if (hi < 1n || !reached(hi)) return null;
	let lo = 1n;
	while (lo < hi) {
		const mid = (lo + hi) / 2n;
		if (reached(mid)) hi = mid;
		else lo = mid + 1n;
	}
	return lo;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}
