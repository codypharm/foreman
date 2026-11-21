import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-lend-fork-live-76480874.json" with {
	type: "json",
};
import { readLendOffers } from "./index.ts";

// A live TapePool quote. NOT MAINNET, AND TAPEPOOL'S INPUTS WERE SET BY US: on a local copy of X Layer
// we deposited voucher #5 alone in a TapePool account, recorded a screen pass for it in TapePool's
// owner's name, moved the clock past the pass's 48 hours, and delivered TapePool's feed a report with
// voucher #5's real BNB Chain values (scripts/record-lend-live-fork-fixture.ts). TapePool's own code
// worked out the quote. Expected values worked out separately from TapePool's CreditMath in Python:
// base weight 306 − 248 = 58 of 1,614,273, expected output 1.76718487 BEM over 7 days and 3.50154830
// over 14; most debt 85% and 80%; the largest advance whose advance plus fee fits.

const AT = { blockNumber: 76_480_874n };
const VOUCHER_5 = parseHex32(fixture.voucher5, "voucher5");
const blockRead = fixture.calls.find(
	(c: { method: string }) => c.method === "eth_getBlockByNumber",
);
if (!blockRead) throw new Error("The fixture has no block read");
const time = BigInt((blockRead.result as { timestamp: string }).timestamp);

describe("a live Lend offer from TapePool (local copy of X Layer, TapePool's inputs set by us)", () => {
	test("each term is TapePool's own quote: the largest advance, its fee and the OKB operating fee", async () => {
		const offers = await readLendOffers(replayClient(fixture), {
			minerKey: VOUCHER_5,
			...AT,
		});
		const live = (termDays: 7 | 14, advance: bigint, fee: bigint) => ({
			option: "lend",
			minerKey: VOUCHER_5,
			termDays,
			state: "live",
			venue: "tapepool",
			readAt: { chainId: 196, block: AT.blockNumber, time },
			voucherId: 5n,
			receivedNow: { currency: "BEM", value: advance },
			fee: { currency: "BEM", value: fee },
			opsFee: { currency: "OKB", value: 0n },
			repayment: "from-output-until-paid",
		});
		expect(offers).toEqual([
			live(7, 149_836_122n, 374_591n),
			live(14, 278_730_212n, 1_393_652n),
		]);
	});
});
