import { describe, expect, test } from "vitest";
import { type CommitmentEvent, confirmCommitment } from "./fabx-commitment.ts";

// The rule: docs/decisions/2026-11-25-fabx-commitment-designer.md (refining
// 2026-11-25-fabx-copy-check.md, decision 5). Values shaped on FabX #1961 at X Layer block
// 76,847,895: commitment block 73,131,773, firstUnusedId 1,960.
const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
const OWNER = "0xf264c21243a974408d0564e50c54425904cd252e" as const;
const EARLIER = "0x442b82eecf854bd8e10805516b4856bcdd24f298" as const;
const STRANGER = "0x3854f739b76bedd5630a1c815b7f382efd423310" as const;

const miner = {
	processor: FABX,
	id: 1961n,
	commitBlock: 73_131_773n,
	firstUnusedId: 1960n,
};
const event = (over: Partial<CommitmentEvent> = {}): CommitmentEvent => ({
	at: { block: 73_131_773n, tx: 3, log: 1 },
	time: 1_791_900_809n,
	designer: OWNER,
	circuits: FABX,
	claimedBlock: 73_131_773n,
	firstUnusedId: 1960n,
	...over,
});

describe("confirming a FabX design commitment by its event", () => {
	test("an event in the claimed block, by a designer who started the circuit, confirms it", () => {
		const e = event();
		expect(confirmCommitment(miner, [e], new Set([OWNER]))).toEqual({
			status: "confirmed",
			by: e,
		});
	});

	test("a designer who started the circuit earlier, before it changed hands, confirms it too", () => {
		const e = event({ designer: EARLIER });
		expect(confirmCommitment(miner, [e], new Set([EARLIER, OWNER]))).toEqual({
			status: "confirmed",
			by: e,
		});
	});

	test("a designer who never started the circuit doesn't", () => {
		expect(
			confirmCommitment(
				miner,
				[event({ designer: STRANGER })],
				new Set([OWNER]),
			),
		).toEqual({
			status: "unconfirmed",
			reason:
				"no commitment event in block 73131773 by an address that started this circuit, with its firstUnusedId",
		});
	});

	test("a migrated event, emitted later and claiming this block, doesn't", () => {
		const migrated = event({ at: { block: 73_186_188n, tx: 0, log: 7 } });
		expect(confirmCommitment(miner, [migrated], new Set([OWNER])).status).toBe(
			"unconfirmed",
		);
		const backdated = event({ claimedBlock: 73_065_045n });
		expect(
			confirmCommitment(
				{ ...miner, commitBlock: 73_065_045n },
				[backdated],
				new Set([OWNER]),
			).status,
		).toBe("unconfirmed");
	});

	test("another firstUnusedId, one above the circuit's id, or another processor doesn't", () => {
		const starters = new Set([OWNER]);
		expect(
			confirmCommitment(miner, [event({ firstUnusedId: 1959n })], starters)
				.status,
		).toBe("unconfirmed");
		expect(
			confirmCommitment(
				{ ...miner, firstUnusedId: 1962n },
				[event({ firstUnusedId: 1962n })],
				starters,
			).status,
		).toBe("unconfirmed");
		expect(
			confirmCommitment(
				miner,
				[event({ circuits: "0x265e2580cb9c3fc059f2aa3cf20ad30f3f0a653c" })],
				starters,
			).status,
		).toBe("unconfirmed");
	});

	test("no event at all in the claimed block doesn't", () => {
		expect(confirmCommitment(miner, [], new Set([OWNER])).status).toBe(
			"unconfirmed",
		);
	});

	test("a miner without a commitment block has none to confirm", () => {
		expect(
			confirmCommitment(
				{ ...miner, commitBlock: 0n },
				[event()],
				new Set([OWNER]),
			),
		).toEqual({ status: "none" });
	});
});
