// Price: the BEM price in US dollars, shown only beside a BEM value with its age.
// Never an input to a valuation or a ranking (docs/decisions/2026-11-19-data-contract.md).

import { ContractParseError } from "./errors.ts";
import { parseObject, parseText, parseUint, serialiseUint } from "./wire.ts";

export interface Price {
	/** US dollars per BEM, 8 decimals: 2,050,000,000 is $20.50. */
	usdPerBem: bigint;
	/** Which feed it came from. */
	source: string;
	/** Unix seconds. */
	readAt: bigint;
}

export function parsePrice(wire: unknown, field: string): Price {
	const w = parseObject(wire, field);
	const usdPerBem = parseUint(w.usdPerBem, `${field}.usdPerBem`);
	if (usdPerBem === 0n) {
		// A zero price is a broken feed, not a price: every dollar figure would read $0.00
		throw new ContractParseError(
			`${field}.usdPerBem`,
			"a price above zero",
			usdPerBem,
		);
	}
	return {
		usdPerBem,
		source: parseText(w.source, `${field}.source`),
		readAt: parseUint(w.readAt, `${field}.readAt`),
	};
}

/** A price for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialisePrice(
	price: Price,
	field: string,
): Record<string, unknown> {
	const wire = {
		usdPerBem: serialiseUint(price.usdPerBem, `${field}.usdPerBem`),
		source: price.source,
		readAt: serialiseUint(price.readAt, `${field}.readAt`),
	};
	parsePrice(wire, field);
	return wire;
}
