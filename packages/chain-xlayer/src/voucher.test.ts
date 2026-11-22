import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-lend-76433326.json" with {
	type: "json",
};
import { readVoucher } from "./index.ts";

// The RIG voucher that stands for a miner, at X Layer block 76,433,326 (20 Nov 2026; the Lend
// fixture, lend.test.ts): voucher #16 names the miner 0x5b65…13d3 and is held by a wallet.

const AT = { blockNumber: 76_433_326n };
const VOUCHER_16 = parseHex32(fixture.voucher16, "voucher16");
const NOT_A_VOUCHER = parseHex32(fixture.notAVoucher, "notAVoucher");

describe("the RIG voucher behind a miner", () => {
	test("a miner held in the rig vault: its voucher, the holder and the X Layer block", async () => {
		expect(
			await readVoucher(replayClient(fixture), {
				minerKey: VOUCHER_16,
				...AT,
			}),
		).toEqual({
			voucherId: 16n,
			holder: "0xd7e004cbda24e079aa3a657ba7f8e2915192a966",
			readAt: { chainId: 196, block: AT.blockNumber, time: 1_795_202_362n },
		});
	});

	test("a miner no voucher names: null, never a made-up voucher", async () => {
		expect(
			await readVoucher(replayClient(fixture), {
				minerKey: NOT_A_VOUCHER,
				...AT,
			}),
		).toBeNull();
	});
});
