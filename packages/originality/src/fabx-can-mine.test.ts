import { describe, expect, test } from "vitest";
import { fabxCanMine } from "./index.ts";

// A FabX circuit's can-mine fact, from FabX's miner record as stored at the X Layer block its
// history is read up to (2026-11-25-fabx-can-mine.md). Values are real, read at X Layer block
// 76,847,895: #24 is mining, #66 stopped at block 74,423,691, #25 has no miner record, and
// #6147's netlist is REF records only. No FabX miner is revoked; that case is made up.

const FABX = {
	chainId: 196,
	contract: "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265",
};

describe("whether a FabX circuit can mine", () => {
	test("a miner FabX reports as active is mining now, in FabX's mining contract", () => {
		expect(
			fabxCanMine({ miner: { status: 1, stopBlock: null }, usesRef: false }),
		).toEqual({
			read: true,
			facts: [{ fact: "can-mine", state: "mining" }],
			mining: FABX,
		});
	});

	test("a stopped miner shows the block it stopped at, and no block it can start again from", () => {
		expect(
			fabxCanMine({
				miner: { status: 3, stopBlock: 74_423_691n },
				usesRef: false,
			}),
		).toEqual({
			read: true,
			facts: [
				{
					fact: "can-mine",
					state: "stopped",
					stoppedAt: 74_423_691n,
					canStartFrom: null,
				},
			],
			mining: FABX,
		});
	});

	test("a circuit with no miner record and no REF records could mine, and names no mining contract", () => {
		expect(fabxCanMine({ miner: null, usesRef: false })).toEqual({
			read: true,
			facts: [{ fact: "can-mine", state: "not-started" }],
			mining: null,
		});
	});

	test("a circuit with no miner record whose netlist uses REF records can't mine", () => {
		expect(fabxCanMine({ miner: null, usesRef: true })).toEqual({
			read: true,
			facts: [
				{
					fact: "can-mine",
					state: "cant-mine",
					reasons: [{ reason: "uses-ref" }],
				},
			],
			mining: null,
		});
	});

	test("a revoked miner gets no result: there is no reason Foreman can show", () => {
		// made up: no FabX miner is revoked
		expect(
			fabxCanMine({ miner: { status: 2, stopBlock: null }, usesRef: false }),
		).toMatchObject({ read: false });
	});

	test("never a design bonus: its meaning in FabX's unverified code is an assumption", () => {
		const read = fabxCanMine({
			miner: { status: 1, stopBlock: null },
			usesRef: false,
		});
		expect(read.read && read.facts.some((f) => f.fact === "design-bonus")).toBe(
			false,
		);
	});
});
