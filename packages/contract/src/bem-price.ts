// BEM's price in BNB, for payback only (docs/decisions/2026-11-20-payback-and-bem-price.md): the
// BEM/WBNB pool's 30-minute time-weighted average at one block, with what the pool holds, so a
// thin market is shown as thin. Unlike `Price`, it is an input: payback divides by it.

import { type BnbRead, parseBnbRead, serialiseBnbRead } from "./bnb.ts";
import { ContractParseError } from "./errors.ts";
import {
	type Address,
	parseAddress,
	parseObject,
	parseUint,
	serialiseUint,
} from "./wire.ts";

/** The rule's averaging window: 30 minutes before the block. */
export const BEM_PRICE_AVERAGED_OVER = 1800;

export interface BemPrice {
	/** BNB wei per whole BEM (10^8 base units). Never 0. */
	bnbPerBem: bigint;
	pool: Address;
	/** Seconds before readAt.block the average covers. */
	averagedOver: typeof BEM_PRICE_AVERAGED_OVER;
	/** BEM base units the pool holds at readAt.block. */
	poolBem: bigint;
	/** WBNB wei the pool holds at readAt.block. */
	poolWbnb: bigint;
	readAt: BnbRead;
}

export function parseBemPrice(wire: unknown, field: string): BemPrice {
	const w = parseObject(wire, field);
	const bnbPerBem = parseUint(w.bnbPerBem, `${field}.bnbPerBem`);
	if (bnbPerBem === 0n) {
		throw new ContractParseError(
			`${field}.bnbPerBem`,
			"a price above zero",
			bnbPerBem,
		);
	}
	if (w.averagedOver !== BEM_PRICE_AVERAGED_OVER) {
		throw new ContractParseError(
			`${field}.averagedOver`,
			`${BEM_PRICE_AVERAGED_OVER} (the 30-minute average)`,
			w.averagedOver,
		);
	}
	return {
		bnbPerBem,
		pool: parseAddress(w.pool, `${field}.pool`),
		averagedOver: BEM_PRICE_AVERAGED_OVER,
		poolBem: parseUint(w.poolBem, `${field}.poolBem`),
		poolWbnb: parseUint(w.poolWbnb, `${field}.poolWbnb`),
		readAt: parseBnbRead(w.readAt, `${field}.readAt`),
	};
}

/** A BEM price for the wire. Parses its own output, so it never sends what readers would refuse. */
export function serialiseBemPrice(
	price: BemPrice,
	field: string,
): Record<string, unknown> {
	const wire = {
		bnbPerBem: serialiseUint(price.bnbPerBem, `${field}.bnbPerBem`),
		pool: price.pool,
		averagedOver: price.averagedOver,
		poolBem: serialiseUint(price.poolBem, `${field}.poolBem`),
		poolWbnb: serialiseUint(price.poolWbnb, `${field}.poolWbnb`),
		readAt: serialiseBnbRead(price.readAt, `${field}.readAt`),
	};
	parseBemPrice(wire, field);
	return wire;
}
