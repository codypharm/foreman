import { parseHex32 } from "@foreman/contract";
import { expect, test } from "vitest";
import { rentOffer } from "./index.ts";

// No rental market exists for miners or RIG vouchers (docs/decisions/2026-11-19-offer-venues.md):
// Rent is always shown as "no rental market yet", never as a zero or an estimate.

test("Rent is always no venue: no rental market exists yet", () => {
	const key = parseHex32(`0x${"ab".repeat(32)}`, "key");
	expect(rentOffer(key)).toEqual({
		option: "rent",
		minerKey: key,
		state: "no-venue",
	});
});
