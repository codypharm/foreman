// Which copies a Telegram chat is told about (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decision 3; 2026-11-26-telegram-alerts-for-pro.md). From a followed address's wallet page: only
// listings after the address was followed and after the miner came to it, never one already sent
// to the chat, and one alert per design per run. Facts, never accusations.

import type {
	CircuitRef,
	CopyListing,
	Hex32,
	WalletMiners,
} from "@foreman/contract";
import type { TelegramFollow } from "@foreman/index";

export interface DesignAlert {
	chatId: bigint;
	address: TelegramFollow["address"];
	/** The first of the address's miners with this design, in the wallet page's order. */
	held: CircuitRef;
	netlistHash: Hex32;
	/** The new copies' listings, newest first, each once. */
	copies: CopyListing[];
}

export function planAlerts(
	page: WalletMiners,
	follow: TelegramFollow,
	sent: ReadonlySet<bigint>,
): DesignAlert[] {
	const byDesign = new Map<Hex32, DesignAlert>();
	for (const miner of page.miners) {
		if (!miner.alert) continue;
		const since = miner.heldAs.kind === "nft" ? miner.heldAs.ownerSince : 0n;
		const fresh = miner.alert.copies.filter(
			(c) =>
				c.listing.listedAt.block > follow.followedAtBlock &&
				c.listing.listedAt.block > since &&
				!sent.has(c.listing.listingId),
		);
		if (fresh.length === 0) continue;
		const hash = miner.alert.netlistHash;
		const alert = byDesign.get(hash) ?? {
			chatId: follow.chatId,
			address: follow.address,
			held: miner.circuit,
			netlistHash: hash,
			copies: [],
		};
		for (const c of fresh) {
			if (
				!alert.copies.some((o) => o.listing.listingId === c.listing.listingId)
			) {
				alert.copies.push(c);
			}
		}
		byDesign.set(hash, alert);
	}
	for (const alert of byDesign.values()) {
		alert.copies.sort((a, b) =>
			a.listing.listedAt.block === b.listing.listedAt.block
				? Number(b.listing.listingId - a.listing.listingId)
				: a.listing.listedAt.block > b.listing.listedAt.block
					? -1
					: 1,
		);
	}
	return [...byDesign.values()];
}
