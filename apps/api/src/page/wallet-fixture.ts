// The wallet page's fixture (docs/decisions/2026-11-22-wallet-miners.md), shared by the wallet page's
// tests and the Telegram alerts' tests: the result page's fixture index and stored results, with the
// market at BNB block 134,900,065. Which circuits are identical, their tape-outs, design commitments
// and stored verdicts are chain data. The wallet's holdings and the extra listings are made up to
// cover the alert rules. X Layer is the held-voucher fixture: WALLET holds no voucher there,
// VOUCHER_HOLDER holds #16 and #19.

import { replayClient } from "@foreman/chain-bnb/fixture";
import held from "@foreman/chain-xlayer/fixtures/xlayer-held-vouchers.json" with {
	type: "json",
};
import { parseAddress } from "@foreman/contract";
import type pg from "pg";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { MINE6, P0, pageIndex } from "./page-fixture.ts";
import { readWalletMiners } from "./wallet-page.ts";

export const MARKET = {
	block: BigInt(fixture.market.block),
	time: BigInt(fixture.market.time),
};
export const WALLET = parseAddress(held.noVouchers, "wallet");
export const VOUCHER_HOLDER = parseAddress(held.holder, "voucher holder");
export const OTHER = parseAddress(`0x${"ab".repeat(20)}`, "other");
export const OWNERS_UP_TO = 134_673_279n;
export const DAY = 86_400n;

/** Made up: the circuits WALLET holds. P0/6534 was never started, so it isn't one of its miners. */
export const HOLDS = [
	{ processor: MINE6, id: 46 }, // 1 gate, no earlier copy: below the floor
	{ processor: MINE6, id: 128 }, // too small to tell
	{ processor: MINE6, id: 967 }, // no earlier copy; 1784 and 2397 are later and identical
	{ processor: MINE6, id: 1008 }, // a copy; 1144 and 1147 are later and identical
	{ processor: MINE6, id: 1144 }, // a copy; 1147 is later, by the same address
	{ processor: MINE6, id: 1570 }, // committed before 1510, which taped out first
	{ processor: MINE6, id: 2510 }, // a copy of 2683, which the page fixture lists
	{ processor: P0, id: 6534 },
];

/** Made up: open listings, each by OTHER unless it says the wallet. */
export const LISTINGS = [
	{ listingId: 30_001, processor: MINE6, id: 2397, ago: 3_600n },
	{ listingId: 30_002, processor: MINE6, id: 1784, ago: 10n * DAY },
	{ listingId: 30_003, processor: MINE6, id: 1147, ago: 2n * DAY },
	{ listingId: 30_004, processor: MINE6, id: 1144, ago: DAY, seller: WALLET },
	{ listingId: 30_005, processor: MINE6, id: 1510, ago: 3n * DAY },
	{ listingId: 30_006, processor: P0, id: 5388, ago: DAY },
];

export async function setUp(options: { ownersFollowed?: boolean } = {}) {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: MARKET,
		networkDays: fixture.networkDays,
	});
	for (const [i, c] of HOLDS.entries()) {
		await pool.query(
			`insert into circuit_owners (processor, id, owner, block, tx_index, log_index)
			 values ($1, $2, $3, $4, 0, 0)`,
			[c.processor, c.id, WALLET, 130_000_000 + i],
		);
	}
	if (options.ownersFollowed ?? true) {
		await pool.query("update index_state set owners_up_to_block = $1", [
			OWNERS_UP_TO.toString(),
		]);
	}
	for (const l of LISTINGS) {
		// About 3 seconds a block on BNB Chain; only the time decides "just listed"
		const blocksAgo = l.ago / 3n;
		await pool.query(
			// Its miner state, made up and read at the market block: stopped, no weight (unused here)
			`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
			   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
			   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
			 values ($1, $2, true, $3, $4, $5, $6, 100, $7, $8, $2, true, 0, 0, 0, 0, 0)`,
			[
				l.listingId,
				MARKET.block.toString(),
				l.seller ?? OTHER,
				l.processor,
				l.id,
				(10n ** 17n).toString(),
				(MARKET.block - blocksAgo).toString(),
				(MARKET.time - l.ago).toString(),
			],
		);
	}
	return pool;
}

export const xlayer = () => replayClient(held);

export async function walletPage(pool: pg.Pool, wallet = WALLET) {
	const read = await readWalletMiners({ pool, xlayer: xlayer() }, wallet);
	if (!read.ok) throw new Error(read.error.detail);
	return read.page;
}
