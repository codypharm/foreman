import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { createPublicClient, custom } from "viem";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-lend-76433326.json" with {
	type: "json",
};
import { readVoucher, VOUCHER_READS_AT_ONCE } from "./index.ts";

// The RIG voucher that stands for a miner, at X Layer block 76,433,326 (20 Nov 2026; the Lend
// fixture, lend.test.ts): voucher #16 names the miner 0x5b65…13d3 and is held by a wallet.

const AT = { blockNumber: 76_433_326n };
const VOUCHER_16 = parseHex32(fixture.voucher16, "voucher16");
const NOT_A_VOUCHER = parseHex32(fixture.notAVoucher, "notAVoucher");

/**
 * The fixture's replay, where each answer takes a few milliseconds, as a node's would, and the most
 * requests in flight at once is counted. `fail` names call data the node always refuses.
 */
function slowReplay(fail?: string) {
	const replay = replayClient(fixture);
	const seen = { inFlight: 0, most: 0 };
	const client = createPublicClient({
		transport: custom({
			async request(args) {
				seen.inFlight++;
				seen.most = Math.max(seen.most, seen.inFlight);
				try {
					await new Promise((r) => setTimeout(r, 5));
					const data = (args.params as [{ data?: string }] | undefined)?.[0]
						?.data;
					if (fail && data === fail) throw new Error("node down");
					return await replay.request(args as never);
				} finally {
					seen.inFlight--;
				}
			},
		}),
	});
	return { client, seen };
}

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

	test("reads the vouchers several at a time, never one by one, and no more than the cap", async () => {
		// 22 Nov 2026: one by one took 14.9 s of a 17 s circuit page on X Layer's public node
		const { client, seen } = slowReplay();
		expect(
			(await readVoucher(client, { minerKey: VOUCHER_16, ...AT }))?.voucherId,
		).toBe(16n);
		expect(seen.most).toBeGreaterThan(1);
		expect(seen.most).toBeLessThanOrEqual(VOUCHER_READS_AT_ONCE);
	});

	test("one voucher that can't be read fails the lookup, never a null that says there's no voucher", async () => {
		// tokenByIndex(5), refused every time, retries included
		const { client } = slowReplay(`0x4f6ccce7${"5".padStart(64, "0")}`);
		await expect(
			readVoucher(client, { minerKey: NOT_A_VOUCHER, ...AT }),
		).rejects.toThrow();
	});
});
