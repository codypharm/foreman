import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-lend-fork-76433552.json" with {
	type: "json",
};
import { readLendOffers } from "./index.ts";

// Vouchers in TapePool accounts. NOT MAINNET: no voucher was deposited with TapePool on 20 Nov 2026,
// so these reads come from a local copy of X Layer forked at block 76,433,546, where the only
// changes were deposits by the vouchers' real holders (scripts/record-lend-fork-fixture.ts).
// TapePool's contracts, feed and screen are untouched: each quote is TapePool's own answer.
// Checked separately with cast on the copy: account 0xD453…c1C1 holds only #16, and TapePool's
// quote gives reason 6 ("denied") for both terms; account 0xef16…c0aE holds #4 and #6.

const AT = { blockNumber: 76_433_552n };
const VOUCHER_16 = parseHex32(fixture.voucher16, "voucher16");
const VOUCHER_4 = parseHex32(fixture.voucher4, "voucher4");
const blockRead = fixture.calls.find(
	(c: { method: string }) => c.method === "eth_getBlockByNumber",
);
if (!blockRead) throw new Error("The fixture has no block read");
const checkedAt = BigInt((blockRead.result as { timestamp: string }).timestamp);

describe("Lend offers for vouchers in TapePool accounts (local copy of X Layer)", () => {
	test("a voucher TapePool declines: none for both terms, with TapePool's reason", async () => {
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
				checkedAt,
				reason: { kind: "declined", voucherId: 16n, tapepool: "denied" },
			})),
		);
	});

	test("a voucher sharing its account: none for both terms, never the account's quote as its own", async () => {
		const offers = await readLendOffers(replayClient(fixture), {
			minerKey: VOUCHER_4,
			...AT,
		});
		expect(offers).toEqual(
			[7, 14].map((termDays) => ({
				option: "lend",
				minerKey: VOUCHER_4,
				termDays,
				state: "none",
				checkedAt,
				reason: { kind: "shared-account", voucherId: 4n, vouchers: 2 },
			})),
		);
	});
});
