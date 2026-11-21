import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-lend-76433326.json" with {
	type: "json",
};
import { readLendOffers } from "./index.ts";

// Lend offers at X Layer block 76,433,326 (20 Nov 2026), when no RIG voucher was deposited with
// TapePool (docs/notes/2026-11-20-tapepool-lend.md). Checked separately: voucher #16 names circuit
// 17,663 on processor 0xb102…a14c, whose miner (key 0x5b65…13d3) is active on BNB Chain and held
// by the rig vault's cell for that key; its holder 0xD7E0…a966 is a wallet. The other key is a
// BNB Chain miner that no voucher names.

const AT = { blockNumber: 76_433_326n };
const CHECKED_AT = 1_795_202_362n;
const VOUCHER_16 = parseHex32(fixture.voucher16, "voucher16");
const NOT_A_VOUCHER = parseHex32(fixture.notAVoucher, "notAVoucher");

describe("Lend offers from TapePool", () => {
	test("a miner no RIG voucher stands for: none for both terms, TapePool lends only against vouchers", async () => {
		const offers = await readLendOffers(replayClient(fixture), {
			minerKey: NOT_A_VOUCHER,
			...AT,
		});
		expect(offers).toEqual(
			[7, 14].map((termDays) => ({
				option: "lend",
				minerKey: NOT_A_VOUCHER,
				termDays,
				state: "none",
				checkedAt: CHECKED_AT,
				reason: { kind: "not-a-voucher" },
			})),
		);
	});

	test("a voucher held by a wallet, not a TapePool account: none for both terms, naming the voucher", async () => {
		const offers = await readLendOffers(replayClient(fixture), {
			minerKey: VOUCHER_16,
			...AT,
		});
		expect(offers).toEqual(
			[7, 14].map((termDays) => ({
				option: "lend",
				minerKey: VOUCHER_16,
				termDays,
				state: "none",
				checkedAt: CHECKED_AT,
				reason: { kind: "not-deposited", voucherId: 16n },
			})),
		);
	});

	test("a failed read is an error, never a quiet none", async () => {
		await expect(
			readLendOffers(replayClient(fixture), {
				minerKey: VOUCHER_16,
				blockNumber: AT.blockNumber + 1n,
			}),
		).rejects.toThrow("No saved response");
	});
});
