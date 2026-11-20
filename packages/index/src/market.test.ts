import { replayClient } from "@foreman/chain-bnb/fixture";
import fixture from "@foreman/chain-bnb/fixtures/bnb-market-scan-134650000-134713299.json" with {
	type: "json",
};
import openListings from "@foreman/chain-bnb/fixtures/market-scan-open-listings.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { followMarket, readMarketBook } from "./index.ts";
import { emptyIndexAt, TEST_DATABASE_URL } from "./testing.ts";

// One follow of the market over blocks 134,650,000 to 134,713,299, from an index that holds
// listing ids 1 to 28,106 with the 40 recorded open ones among them open
// (packages/chain-bnb/scripts/record-market-scan-fixture.ts). Rules:
// docs/decisions/2026-11-20-market-index.md.
const FROM = 134_650_000n;
const TO = 134_713_299n;

/** A market index up to the block before FROM: ids 1 to `issued`, the recorded open ones open. */
async function marketIndexedBefore(issued = 28_106) {
	const pool = await emptyIndexAt(TO);
	await pool.query(
		"update index_state set market_up_to_block = $1, market_up_to_time = 1",
		[(FROM - 1n).toString()],
	);
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open)
		 select id, $1, false from generate_series(1, $2::int) as id`,
		[(FROM - 1n).toString(), issued],
	);
	for (const l of openListings) {
		if (BigInt(l.listingId) > BigInt(issued)) continue;
		await pool.query(
			`update market_listings set open = true, seller = $2, processor = $3, token_id = $4,
			 price_wei = $5, fee_bps = 100 where listing_id = $1`,
			[l.listingId, l.seller, l.processor, l.tokenId, l.priceWei],
		);
	}
	return pool;
}

describe.skipIf(!TEST_DATABASE_URL)("following the market", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("saves the range's sales and every listing it touched, and moves the market's block", async () => {
		pool = await marketIndexedBefore();
		const result = await followMarket(pool, replayClient(fixture), {
			toBlock: TO,
		});
		expect(result).toMatchObject({ followed: true, sales: 2, listings: 9 });
		const sales = await pool.query(
			"select listing_id::text, block::text, miner_status from market_sales order by block",
		);
		expect(sales.rows).toEqual([
			{ listing_id: "28107", block: "134671741", miner_status: 0 },
			{ listing_id: "28108", block: "134688886", miner_status: 0 },
		]);
		const book = await readMarketBook(pool);
		expect(book.upToBlock).toBe(TO);
		expect(book.listingsIndexed).toBe(28_111n);
		expect(book.open.map((l) => l.listingId)).not.toContain(28_107n);
		expect(book.open.find((l) => l.listingId === 27_912n)?.seller).toBe(
			"0xf321e19068971ddd281c3aeb2f2de5ebc4e15f6f",
		);
	});

	test("keeps every open listing's miner and whether it can be bought, at the follow's block", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		const states = await pool.query(
			`select listing_id::text, buyable, miner_status, miner_task_id, miner_verif_weight::text,
			   state_read_at_block::text from market_listings where open order by listing_id`,
		);
		expect(states.rows).toHaveLength(41);
		expect(
			states.rows.every((r) => r.state_read_at_block === TO.toString()),
		).toBe(true);
		expect(
			states.rows.filter((r) => !r.buyable).map((r) => r.listing_id),
		).toEqual(["27993", "28078"]);
		expect(states.rows.find((r) => r.listing_id === "28111")).toMatchObject({
			buyable: true,
			miner_status: 1,
			miner_task_id: 220,
			miner_verif_weight: "61",
		});
	});

	test("saves nothing when the scan stops", async () => {
		// One listing short: the count check against nextListingId fails
		pool = await marketIndexedBefore(28_105);
		const result = await followMarket(pool, replayClient(fixture), {
			toBlock: TO,
		});
		expect(result).toEqual({
			followed: false,
			detail: expect.stringContaining("nextListingId"),
		});
		const book = await readMarketBook(pool);
		expect(book.upToBlock).toBe(FROM - 1n);
		const sales = await pool.query(
			"select count(*)::int as n from market_sales",
		);
		expect(sales.rows[0].n).toBe(0);
	});
});
