import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { readCanMine } from "./index.ts";

// "Can mine" and the design bonus, from the mining contract at block 134,673,279
// (fixtures/README.md, "No identical circuit, and miner status"). Expected values were decoded
// from the saved getMiner and processorMultiplier answers with Python. Rules:
// docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md; the design bonus is shown first.
const AT = { blockNumber: 134_673_279n };
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const client = replayClient(fixture);
const NO_REVOKE = null;
/** A circuit with a miner record names TapeOut's mining contract; one without names none. */
const POD = {
	chainId: 56,
	contract: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
};

describe("can mine", () => {
	test("a mining miner holding the design bonus: the contract's answer first, then mining now", async () => {
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 2683n },
					usesRef: false,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: POD,
			facts: [
				{ fact: "design-bonus", holds: true, bonus: 328n },
				{ fact: "can-mine", state: "mining" },
			],
		});
	});

	test("a revoked miner: can't mine, naming the task, the test vector and the block", async () => {
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 1965n },
					usesRef: false,
					revoke: {
						vectorIndex: 140,
						revokedAt: { block: 118_590_677n, txIndex: 2, logIndex: 5 },
					},
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: POD,
			facts: [
				{ fact: "design-bonus", holds: false, bonus: 3752n },
				{
					fact: "can-mine",
					state: "cant-mine",
					reasons: [
						{
							reason: "failed-test-vector",
							taskId: 260,
							vectorIndex: 140,
							block: 118_590_677n,
						},
					],
				},
			],
		});
	});

	test("a revoked miner without its Revoked event in the index is a clear error, never mining or not started", async () => {
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 1965n },
					usesRef: false,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: false,
			detail: expect.stringContaining("Revoked"),
		});
	});

	test("a stopped miner: the stop block, and the block it can start again from", async () => {
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 128n },
					usesRef: false,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: POD,
			facts: [
				{ fact: "design-bonus", holds: false, bonus: 0n },
				{
					fact: "can-mine",
					state: "stopped",
					stoppedAt: 129_714_987n,
					canStartFrom: 129_716_187n,
				},
			],
		});
	});

	test("a circuit never started on an eligible processor, without REF: could mine, and no design bonus fact", async () => {
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 1231n },
					usesRef: false,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: null,
			facts: [{ fact: "can-mine", state: "not-started" }],
		});
	});

	test("lists every reason a circuit can't mine", async () => {
		// P0/6534: a pure wrapper on a processor whose multiplier is 0
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: P0, id: 6534n },
					usesRef: true,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: null,
			facts: [
				{
					fact: "can-mine",
					state: "cant-mine",
					reasons: [
						{ reason: "processor-not-eligible" },
						{ reason: "uses-ref" },
					],
				},
			],
		});
		// MINE6/38: REF records on a processor that can mine
		expect(
			await readCanMine(
				client,
				{
					circuit: { processor: MINE6, id: 38n },
					usesRef: true,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({
			read: true,
			mining: null,
			facts: [
				{
					fact: "can-mine",
					state: "cant-mine",
					reasons: [{ reason: "uses-ref" }],
				},
			],
		});
	});

	test("a failed read is a clear error, never a can-mine answer", async () => {
		expect(
			await readCanMine(
				replayClient({ ...fixture, calls: [] }),
				{
					circuit: { processor: MINE6, id: 2683n },
					usesRef: false,
					revoke: NO_REVOKE,
				},
				AT,
			),
		).toEqual({ read: false, detail: expect.stringContaining("2683") });
	});
});
