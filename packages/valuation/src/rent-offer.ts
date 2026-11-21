// The Rent offer for one miner. No rental market exists (docs/decisions/2026-11-19-offer-venues.md;
// RIG voucher v2 removed the protocol's rental), so Rent is "no rental market yet": never a zero or
// an estimate. When a venue appears, its reader replaces this.

import {
	type Hex32,
	type Offer,
	parseOffer,
	serialiseOffer,
} from "@foreman/contract";

export type RentOffer = Extract<Offer, { option: "rent" }>;

export function rentOffer(minerKey: Hex32): RentOffer {
	const offer: RentOffer = { option: "rent", minerKey, state: "no-venue" };
	return parseOffer(serialiseOffer(offer, "rent"), "rent") as RentOffer;
}
