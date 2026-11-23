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

/** `value` (base units of `decimals`) to `places` decimal places, with digit grouping. */
function fixed(
	value: bigint,
	decimals: number,
	places: number,
	rounding: Rounding,
): string {
	let q = value;
	if (places < decimals) {
		const p = 10n ** BigInt(decimals - places);
		const rest = value % p;
		q = value / p;
		if (
			(rounding === "up" && rest > 0n) ||
			(rounding === "nearest" && rest * 2n >= p)
		)
			q += 1n;
	} else {
		q = value * 10n ** BigInt(places - decimals);
	}
	if (places === 0) return q.toLocaleString("en");
	const digits = q.toString().padStart(places + 1, "0");
	return `${BigInt(digits.slice(0, -places)).toLocaleString("en")}.${digits.slice(-places)}`;
}

const trimZeros = (s: string) =>
	s.includes(".") ? s.replace(/\.?0+$/, "") : s;

/**
 * A BEM estimate as the result page shows it (docs/mocks/2026-11-21-result-page.html): whole BEM from
 * 1,000, one decimal from 1, four significant figures below 1. Low ends round down and high ends up,
 * so the range shown always contains the estimate.
 */
export function formatBem(
	value: bigint,
	rounding: Rounding = "nearest",
): string {
	if (value >= 1000n * 10n ** 8n) return fixed(value, 8, 0, rounding);
	if (value >= 10n ** 8n) return fixed(value, 8, 1, rounding);
	return significant(value, 8, 4, rounding);
}

/** An amount to `sig` significant figures, trailing zeros dropped ("0.78 BNB"). */
export function formatAmount(amount: Amount, sig = 4): string {
	return `${trimZeros(significant(amount.value, DECIMALS[amount.currency], sig, "nearest"))} ${amount.currency}`;
}

/** BEM base units a second as BEM a day, to six decimals ("7,199.999712"). */
export function formatBemPerDay(perSecond: bigint, share = 100n): string {
	return trimZeros(
		fixed((perSecond * 86_400n * share) / 100n, 8, 6, "nearest"),
	);
}

/** Parts per million a day as a percentage: two decimals, or one significant figure below 0.01 ("0.008"). */
export function formatPpmPercent(ppm: bigint): string {
	if (ppm >= 100n) return trimZeros(fixed(ppm, 4, 2, "nearest"));
	return trimZeros(significant(ppm, 4, 1, "nearest"));
}

/** part ÷ whole as a percentage, three significant figures ("0.0978"). */
export function formatShare(part: bigint, whole: bigint): string {
	if (whole <= 0n) return "–";
	return trimZeros(
		significant((part * 100n * 10n ** 18n) / whole, 18, 3, "nearest"),
	);
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** A block's Unix time as a UTC date ("6 Sep 2026"). */
export function formatDate(unix: bigint): string {
	const d = new Date(Number(unix) * 1000);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "0xb557…3618" */
export function shortHex(hex: string): string {
	return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/** How much earlier one time is than another, in the largest whole unit ("9 days"). */
export function formatGap(seconds: bigint): string {
	const units: [bigint, string][] = [
		[86_400n, "day"],
		[3_600n, "hour"],
		[60n, "minute"],
	];
	for (const [size, name] of units) {
		const n = seconds / size;
		if (n >= 1n) return `${formatCount(n)} ${name}${n === 1n ? "" : "s"}`;
	}
	return `${formatCount(seconds)} second${seconds === 1n ? "" : "s"}`;
}
