// A Telegram alert's words (docs/decisions/2026-11-23-copy-alert-notifications.md, decision 8;
// 2026-11-26-telegram-alerts-for-pro.md, decision 3): facts only, never a value, advice, or words
// like "fake" or "stolen". It names the followed address rather than saying "your", because anyone
// can follow any address, and links to the held miner's result page and the newest copy's.

import type { CircuitRef } from "@foreman/contract";
import type { DesignAlert } from "./plan.ts";

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

export function alertMessage(alert: DesignAlert, webUrl: string): string {
	const newest = alert.copies[0];
	if (!newest) throw new Error("an alert needs at least one copy");
	const n = alert.copies.length;
	const held = `#${alert.held.tokenId}`;
	const by = shortAddress(alert.address);
	const lead =
		n === 1
			? `A new copy of ${held}, held by ${by}, was listed on TapeOut's market.`
			: `${n} new copies of ${held}, held by ${by}, were listed on TapeOut's market.`;
	const what = `${n === 1 ? "" : "Newest: "}#${newest.circuit.tokenId} at ${bnb(newest.listing.ask.value)} BNB, listed ${day(newest.listing.listedAt.time)}.`;
	return [
		`${lead} ${what} Identical netlist, designed later.`,
		"",
		`${held}: ${pageUrl(webUrl, alert.held)}`,
		`#${newest.circuit.tokenId}: ${pageUrl(webUrl, newest.circuit)}`,
	].join("\n");
}

export function pageUrl(webUrl: string, circuit: CircuitRef): string {
	return `${webUrl.replace(/\/+$/, "")}/#/circuit/${circuit.processor}/${circuit.tokenId}`;
}

/** A date as "26 Dec 2026", in UTC. */
export function formatDay(date: Date): string {
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** 0x077e…2ea5 */
export function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Wei to BNB, at most 4 decimals, rounded down, trailing zeros dropped. */
function bnb(wei: bigint): string {
	const whole = wei / 10n ** 18n;
	const frac = ((wei % 10n ** 18n) / 10n ** 14n).toString().padStart(4, "0");
	const trimmed = frac.replace(/0+$/, "");
	return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

/** A unix time as "20 Nov", in UTC. */
function day(time: bigint): string {
	const d = new Date(Number(time) * 1000);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
