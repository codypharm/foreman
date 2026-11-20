import { replayClient } from "@foreman/chain-bnb/fixture";
import fixture from "@foreman/chain-bnb/fixtures/bnb-market-scan-134650000-134713299.json" with {
	type: "json",
};
import openListings from "@foreman/chain-bnb/fixtures/market-scan-open-listings.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { followMarket, readMarketBook, readSellMarket } from "./index.ts";
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

	test("gives the Sell rule the last 14 days' sales and the asks that can be bought, at the market's block", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		const { rows } = await pool.query<{ t: string }>(
			"select market_up_to_time::text as t from index_state",
		);
		const market = await readSellMarket(pool);
		expect(market.at).toEqual({
			chainId: 56,
			block: TO,
			time: BigInt(rows[0]?.t ?? 0),
		});
		expect(market.sales.map((s) => s.readAt.block)).toEqual([
			134_671_741n,
			134_688_886n,
		]);
		expect(market.sales.every((s) => !s.miner.mining)).toBe(true);
		// 41 open, 2 of them can't be bought
		expect(market.asks).toHaveLength(39);
		expect(market.asks.every((a) => a.readAt.block === TO)).toBe(true);
		const ask = await pool.query<{ price_wei: string }>(
			"select price_wei::text from market_listings where listing_id = 28111",
		);
		expect(market.asks).toContainEqual({
			priceWei: BigInt(ask.rows[0]?.price_wei ?? 0),
			readAt: market.at,
			miner: { mining: true, pool: "verified", weight: 61n },
		});
	});

	test("refuses to give the Sell rule anything before the market's first fill", async () => {
		pool = await emptyIndexAt(TO);
		await expect(readSellMarket(pool)).rejects.toThrow("not filled yet");
	});

	test("refuses a sale from the last 14 days whose miner was never read, never dropping it", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		await pool.query(
			`update market_sales set miner_status = null, miner_task_id = null,
			   miner_verif_weight = null, miner_unver_weight = null where block = 134688886`,
		);
		await expect(readSellMarket(pool)).rejects.toThrow(
			"no miner state for the sale at block 134688886",
		);
	});

	test("leaves out sales older than 14 days, which have no miner state", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		const { at } = await readSellMarket(pool);
		const window = 14n * 86_400n;
		for (const [block, time] of [
			[1n, at.time - window - 1n],
			[2n, at.time - window],
		] as const) {
			await pool.query(
				`insert into market_sales (block, log_index, tx, time, listing_id, processor, token_id,
				   buyer, price_wei, fee_wei, miner_status, miner_task_id, miner_verif_weight, miner_unver_weight)
				 values ($1, 0, $2, $3, 1, $4, 1, $4, 1000, 10, $5, $6, $7, $8)`,
				block === 1n
					? [
							block,
							`0x${"1".repeat(64)}`,
							time,
							`0x${"2".repeat(40)}`,
							null,
							null,
							null,
							null,
						]
					: [
							block,
							`0x${"3".repeat(64)}`,
							time,
							`0x${"2".repeat(40)}`,
							1,
							0,
							0,
							7,
						],
			);
		}
		const market = await readSellMarket(pool);
		// The one exactly 14 days old is in, the one a second older is out
		expect(market.sales.map((s) => s.readAt.block)).toEqual([
			2n,
			134_671_741n,
			134_688_886n,
		]);
		expect(market.sales[0]?.miner).toEqual({
			mining: true,
			pool: "unverified",
			weight: 7n,
		});
	});

	test("counts only an active miner as mining, never a revoked or cooling one", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		await pool.query(
			"update market_sales set miner_status = 2, miner_task_id = 4 where block = 134671741",
		);
		await pool.query(
			"update market_sales set miner_status = 3, miner_task_id = 4 where block = 134688886",
		);
		const market = await readSellMarket(pool);
		expect(market.sales.map((s) => s.miner)).toEqual([
			{ mining: false },
			{ mining: false },
		]);
	});

	test("refuses an ask whose miner is mining with no weight in its pool", async () => {
		pool = await marketIndexedBefore();
		await followMarket(pool, replayClient(fixture), { toBlock: TO });
		await pool.query(
			"update market_listings set miner_verif_weight = 0, miner_unver_weight = 5 where listing_id = 28111",
		);
		await expect(readSellMarket(pool)).rejects.toThrow(
			"listing 28111 is mining with no weight",
		);
	});
});
