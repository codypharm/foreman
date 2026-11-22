import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseAddress } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-held-vouchers.json" with {
	type: "json",
};
import { rigVoucherAbi } from "./abi.ts";
import { RIG_VOUCHER, readHeldVouchers } from "./index.ts";

// RIG on X Layer at one block, read on 22 Nov 2026: a wallet holding 2 vouchers (#19 among them)
// and a wallet holding none, with each voucher's ownerOf read independently.
const blockNumber = BigInt(fixture.block);
const holder = parseAddress(fixture.holder, "holder");
const noVouchers = parseAddress(fixture.noVouchers, "noVouchers");

describe("reading the vouchers a wallet holds", () => {
	test("gives each voucher the wallet holds with its miner's circuit", async () => {
		const client = replayClient(fixture);
		const held = await readHeldVouchers(client, { holder, blockNumber });
		expect(held.readAt).toMatchObject({ chainId: 196, block: blockNumber });
		expect(held.vouchers).toHaveLength(2);
		expect(held.vouchers.map((v) => v.voucherId)).toContain(19n);
		for (const v of held.vouchers) {
			const owner = await client.readContract({
				address: RIG_VOUCHER,
				abi: rigVoucherAbi,
				functionName: "ownerOf",
				args: [v.voucherId],
				blockNumber,
			});
			expect(owner.toLowerCase()).toBe(fixture.holder);
			expect(v.circuit.processor).toMatch(/^0x[0-9a-f]{40}$/);
		}
	});

	test("a wallet holding none has an empty list", async () => {
		const held = await readHeldVouchers(replayClient(fixture), {
			holder: noVouchers,
			blockNumber,
		});
		expect(held.vouchers).toEqual([]);
	});

	test("a failed read rejects, never an empty list", async () => {
		await expect(
			readHeldVouchers(
				replayClient({
					...fixture,
					calls: fixture.calls.filter(
						(c) =>
							!JSON.stringify(c.params).includes("0x4f6ccce7") &&
							!JSON.stringify(c.params).includes("0x2f745c59"),
					),
				}),
				{ holder, blockNumber },
			),
		).rejects.toThrow();
	});
});
