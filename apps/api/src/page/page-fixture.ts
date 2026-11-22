// The result page's test setup, shared by its test and the script that records its fixture
// (scripts/record-page-fixture.ts), so the two can't drift apart. The index is the originality
// fixture's, at block 134,673,279 (packages/originality/fixtures/README.md), with its stored results
// built by the results job; the market index is placed at the recorded BNB block, where the page
// reads the miner, the network and the BEM price. The one listing is made up by the test and says
// so; everything else is chain data.

import { minerKey, readMiner } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import { fixtureIndexedDatabase } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import type { PublicClient } from "viem";
import { refreshResults } from "../results/refresh.ts";

export const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c" as const;
export const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9" as const;

/** The circuits the page test reads: a mining miner, a cooling one, and a pasted wrapper. */
export const PAGE_CIRCUITS = {
	/** Active, holds the design bonus, the earlier design of MINE6/2510. Listed by the test. */
	mining: { processor: MINE6, id: 2683n },
	/** Stopped by its owner at block 129,714,987. */
	cooling: { processor: MINE6, id: 128n },
	/** A pure wrapper, never a miner and not listed: checked on request as "pasted". */
	pasted: { processor: P0, id: 6534n },
} as const;

/** The made-up listing for PAGE_CIRCUITS.mining: 2 BNB, listed 100 blocks before the market block. */
export const TEST_LISTING = {
	listingId: 28_200n,
	seller: `0x${"fd".repeat(20)}`,
	priceWei: 2n * 10n ** 18n,
};

/** The results job's stored rows at this time (any time; only the stored block matters). */
export const BUILT_AT = 1_795_200_000n;

export interface NetworkDay {
	day: string;
	block: string;
	time: string;
	verifiedWeight: string;
	unverifiedWeight: string;
	minerCount: string;
	verifiedMinerCount: string;
}

/**
 * The fixture index with its stored results, the network days, and the market index at
 * `market` with the test's one listing. `bnb` answers the BNB reads at the market block: the
 * listing's miner state is read from it, as the market follow would.
 */
export async function pageIndex(input: {
	bnb: PublicClient;
	market: { block: bigint; time: bigint };
	networkDays: NetworkDay[];
}): Promise<pg.Pool> {
	const pool = await fixtureIndexedDatabase();
	// MINE6/1965's real Revoked event, which the fixture database leaves out (refresh.test.ts)
	await pool.query(
		`update miners set revoked_block = 118590677, revoked_tx = 2, revoked_log = 5,
		   revoked_vector = 140 where processor = $1 and id = 1965`,
		[MINE6],
	);
	const run = await refreshResults(pool, replayClient(circuits), {
		mode: "full",
		now: BUILT_AT,
	});
	if (!run.refreshed || run.skipped.length > 0) {
		throw new Error("The page fixture's stored results didn't build");
	}

	for (const d of input.networkDays) {
		await pool.query(
			`insert into network_days (day, block, time, verified_weight, unverified_weight,
			   miner_count, verified_miner_count) values ($1, $2, $3, $4, $5, $6, $7)`,
			[
				d.day,
				d.block,
				d.time,
				d.verifiedWeight,
				d.unverifiedWeight,
				d.minerCount,
				d.verifiedMinerCount,
			],
		);
	}

	const { block, time } = input.market;
	await pool.query(
		"update index_state set market_up_to_block = $1, market_up_to_time = $2",
		[block.toString(), time.toString()],
	);
	const miner = await readMiner(input.bnb, minerKey(PAGE_CIRCUITS.mining), {
		blockNumber: block,
	});
	const status = { "not-mining": 0, active: 1, revoked: 2, cooling: 3 }[
		miner.status
	];
	const verified = miner.pool === "verified";
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
		   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
		 values ($1, $2, true, $3, $4, $5, $6, 100, $7, $8, $2, true, $9, $10, $11, $12, $13)`,
		[
			TEST_LISTING.listingId.toString(),
			block.toString(),
			TEST_LISTING.seller,
			PAGE_CIRCUITS.mining.processor,
			PAGE_CIRCUITS.mining.id.toString(),
			TEST_LISTING.priceWei.toString(),
			(block - 100n).toString(),
			(time - 300n).toString(),
			status,
			miner.taskId ?? 0,
			(verified ? miner.weight : 0n).toString(),
			(verified ? 0n : miner.weight).toString(),
			miner.weightWithoutBonus.toString(),
		],
	);
	return pool;
}
