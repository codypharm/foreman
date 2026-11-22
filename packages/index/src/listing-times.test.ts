import { replayClient } from "@foreman/chain-bnb/fixture";
import fixture from "@foreman/chain-bnb/fixtures/bnb-market-events-116708167-116711900.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { fillListingTimes } from "./index.ts";
import { emptyIndexAt, TEST_DATABASE_URL } from "./testing.ts";

// The one-off fill of listing times for listings indexed before migration 009, from the market's
// Listed events. The saved logs cover the market's first blocks: listings 1 and 2.
const UP_TO = 116_711_900n;

async function marketIndexedWithoutTimes(listings: number) {
	const pool = await emptyIndexAt(UP_TO);
	await pool.query(
		"update index_state set market_up_to_block = $1, market_up_to_time = 1",
		[UP_TO.toString()],
	);
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open)
		 select id, $1, false from generate_series(1, $2::int) as id`,
		[UP_TO.toString(), listings],
	);
	return pool;
}

describe.skipIf(!TEST_DATABASE_URL)("filling listing times", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("gives every listing its Listed event's block and time", async () => {
		pool = await marketIndexedWithoutTimes(2);
		const result = await fillListingTimes(pool, replayClient(fixture));
		expect(result).toEqual({ filled: true, listings: 2 });
		const { rows } = await pool.query(
			"select listing_id::text, listed_block::text, listed_time::text from market_listings order by listing_id",
		);
		expect(rows).toEqual([
			{ listing_id: "1", listed_block: "116711840", listed_time: "1787081100" },
			{ listing_id: "2", listed_block: "116711888", listed_time: "1787081122" },
		]);
	});

	test("saves nothing when the Listed events don't account for every listing", async () => {
		pool = await marketIndexedWithoutTimes(3);
		const result = await fillListingTimes(pool, replayClient(fixture));
		expect(result).toEqual({
			filled: false,
			detail: expect.stringContaining("3 listings"),
		});
		const { rows } = await pool.query(
			"select count(*)::int as n from market_listings where listed_block is not null",
		);
		expect(rows[0].n).toBe(0);
	});
});
