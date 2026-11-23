import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-voucher-circuit.json" with {
	type: "json",
};
import { readVoucherCircuit } from "./index.ts";

// RIG on X Layer at one block, read on 22 Nov 2026: voucher #19 (live, circuit 0xb102…a14c/12814),
// #3 (redeemed) and #999 (never minted).
const blockNumber = BigInt(fixture.block);

describe("reading the circuit a RIG voucher names", () => {
	test("a live voucher names its miner's circuit", async () => {
		const read = await readVoucherCircuit(replayClient(fixture), {
			voucherId: 19n,
			blockNumber,
		});
		expect(read.readAt).toMatchObject({ chainId: 196, block: blockNumber });
		expect(read.circuit).toEqual({
			processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
			id: 12814n,
		});
	});

	test("a redeemed voucher and one never minted name no circuit, never a made-up one", async () => {
		for (const voucherId of [3n, 999n]) {
			const read = await readVoucherCircuit(replayClient(fixture), {
				voucherId,
				blockNumber,
			});
			expect(read.circuit).toBeNull();
		}
	});

	test("a failed read rejects", async () => {
		await expect(
			readVoucherCircuit(replayClient({ ...fixture, calls: [] }), {
				voucherId: 19n,
				blockNumber,
			}),
		).rejects.toThrow();
	});
});
