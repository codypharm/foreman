// Numbers for the screen, worked in bigint from base units so nothing is lost to floating point.

import type { Amount } from "@foreman/contract";

const DECIMALS = { BNB: 18, OKB: 18, BEM: 8 } as const;

type Rounding = "down" | "up" | "nearest";

/** `value` (in base units of `decimals`) to `sig` significant figures, keeping trailing zeros. */
function significant(
	value: bigint,
	decimals: number,
	sig: number,
	rounding: Rounding,
): string {
	if (value <= 0n) return "0";
	const drop = value.toString().length - sig;
	let q = value;
	let shown = decimals;
	if (drop > 0) {
		const p = 10n ** BigInt(drop);
		const rest = value % p;
		q = value / p;
		if (
			(rounding === "up" && rest > 0n) ||
			(rounding === "nearest" && rest * 2n >= p)
		)
			q += 1n;
		shown = decimals - drop;
	}
	if (shown <= 0) return (q * 10n ** BigInt(-shown)).toLocaleString("en");
	const digits = q.toString().padStart(shown + 1, "0");
	return `${BigInt(digits.slice(0, -shown)).toLocaleString("en")}.${digits.slice(-shown)}`;
}

/** An asking price: 4 significant figures, nearest, trailing zeros dropped ("2.85 BNB"). */
export function formatAsk(amount: Amount): string {
	const s = significant(amount.value, DECIMALS[amount.currency], 4, "nearest");
	return `${s.includes(".") ? s.replace(/\.?0+$/, "") : s} ${amount.currency}`;
}

/**
 * An estimated range, low to high, to 3 significant figures: low rounded down and high rounded up,
 * so the range shown always contains the estimate (docs/mocks/2026-11-22-listings-row-range.html).
 */
export function formatBemRange(low: bigint, high: bigint): string {
	return `${significant(low, DECIMALS.BEM, 3, "down")}–${significant(high, DECIMALS.BEM, 3, "up")}`;
}

export function formatCount(n: number | bigint): string {
	return n.toLocaleString("en");
}
