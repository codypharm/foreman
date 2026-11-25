import { parseWalletMiners } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import wire from "../../fixtures/wallet-077e-135141389.json" with {
	type: "json",
};
import { inTodaysShape } from "../../testing.ts";
import { groupAlerts } from "./alert-groups.ts";

// Real response from Foreman's local API on 22 Nov 2026: wallet 0x077e…2ea5, owner follow at BNB block
// 135,140,617, market at 135,141,389. 64 miners, 21 with an alert, on 4 designs
// (docs/mocks/2026-11-23-copy-alerts-by-design.html).
const wallet = parseWalletMiners(
	{
		...wire,
		miners: wire.miners.map((m) =>
			m.check.state === "checked"
				? {
						...m,
						check: {
							...m.check,
							originality: inTodaysShape(m.check.originality),
						},
					}
				: m,
		),
	},
	"page",
);
const groups = groupAlerts(wallet.miners);
const ids = (g: (typeof groups)[number]) =>
	g.copies.map((c) => c.listing.listingId);

describe("copy alerts, one per design", () => {
	test("the 21 miners with an alert make 4 designs, each miner in exactly one", () => {
		expect(groups.map((g) => g.netlistHash.slice(0, 10))).toEqual([
			"0x956472d6",
			"0xaf1bf09c",
			"0x3f3ab232",
			"0xb546f5b9",
		]);
		expect(groups.map((g) => g.miners.length)).toEqual([16, 3, 1, 1]);
		expect(groups.flatMap((g) => g.miners).length).toBe(
			wallet.miners.filter((m) => m.alert).length,
		);
	});

	test("a listing in several miners' alerts is counted once", () => {
		expect(groups.map((g) => g.copies.length)).toEqual([7, 16, 30, 16]);
		for (const g of groups) expect(new Set(ids(g)).size).toBe(ids(g).length);
		expect(groups.map((g) => g.circuits)).toEqual([7, 16, 30, 16]);
	});

	test("designs with a copy listed this week come first; copies newest first", () => {
		expect(groups.map((g) => g.justListed)).toEqual([3, 3, 0, 0]);
		for (const g of groups) {
			const times = g.copies.map((c) => c.listing.listedAt.time);
			expect([...times].sort((a, b) => Number(b - a))).toEqual(times);
		}
		expect(groups[0]?.copies[0]?.circuit.tokenId).toBe(13931n);
	});

	test("the wallet's earliest miner on a design is the one with the earliest design time", () => {
		expect(groups[0]?.earliest.circuit.tokenId).toBe(10278n);
		expect(groups[1]?.earliest.circuit.tokenId).toBe(10294n);
	});

	test("no alerts, no groups", () => {
		expect(groupAlerts(wallet.miners.filter((m) => !m.alert))).toEqual([]);
	});
});
