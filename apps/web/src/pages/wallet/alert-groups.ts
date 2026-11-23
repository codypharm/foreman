// One copy alert per design (docs/mocks/2026-11-23-copy-alerts-by-design.html, chosen 23 Nov 2026):
// the wallet's miners with the same netlist hash share one card, whose copies are every listing in
// their alerts, each once, newest first. Nothing here judges a circuit; it only gathers the API's alerts.

import {
	type CopyListing,
	designedEarlier,
	type Hex32,
	type WalletMiner,
} from "@foreman/contract";

export interface AlertGroup {
	netlistHash: Hex32;
	/** The wallet's miners on this design, in the API's order. */
	miners: WalletMiner[];
	/** The wallet's miner with the earliest design time. */
	earliest: WalletMiner;
	/** Every listing in these miners' alerts, once each, newest first. */
	copies: CopyListing[];
	/** Distinct circuits among the copies. */
	circuits: number;
	/** Copies listed in the 7 days before the market read. */
	justListed: number;
}

/** Designs with a copy listed this week first, then by their newest listing. */
export function groupAlerts(miners: readonly WalletMiner[]): AlertGroup[] {
	const byHash = new Map<Hex32, WalletMiner[]>();
	for (const m of miners) {
		if (!m.alert) continue;
		const list = byHash.get(m.alert.netlistHash);
		if (list) list.push(m);
		else byHash.set(m.alert.netlistHash, [m]);
	}

	const groups = [...byHash].map(([netlistHash, ms]): AlertGroup => {
		const copies = new Map<bigint, CopyListing>();
		for (const m of ms) {
			for (const c of m.alert?.copies ?? []) {
				if (!copies.has(c.listing.listingId))
					copies.set(c.listing.listingId, c);
			}
		}
		const sorted = [...copies.values()].sort(
			(a, b) =>
				compare(b.listing.listedAt.time, a.listing.listedAt.time) ||
				compare(b.listing.listingId, a.listing.listingId),
		);
		return {
			netlistHash,
			miners: ms,
			earliest: ms.reduce((a, b) =>
				designedEarlier(b.circuit, a.circuit) ? b : a,
			),
			copies: sorted,
			circuits: new Set(
				sorted.map((c) => `${c.circuit.processor}/${c.circuit.tokenId}`),
			).size,
			justListed: sorted.filter((c) => c.justListed).length,
		};
	});

	return groups.sort(
		(a, b) =>
			Number(b.justListed > 0) - Number(a.justListed > 0) ||
			compare(newest(b), newest(a)) ||
			(a.netlistHash < b.netlistHash ? -1 : 1),
	);
}

const newest = (g: AlertGroup) => g.copies[0]?.listing.listedAt.time ?? 0n;

const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
