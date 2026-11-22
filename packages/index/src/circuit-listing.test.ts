import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { readCircuitListing } from "./index.ts";
import { emptyIndexAt, TEST_DATABASE_URL } from "./testing.ts";

// A circuit's open listing for its result page (docs/data-contract.md, CircuitPage.listing), read
// from the market index at the block the market follow reached (2026-11-21-circuit-page-reads.md).

const BLOCK = 134_895_911n;
const TIME = 1_795_268_036n;
const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const SELLER = `0x${"fd".repeat(20)}`;
const circuit = { processor: PROCESSOR as never, id: 2421n };

async function marketAt() {
	const pool = await emptyIndexAt(BLOCK);
	await pool.query(
		"update index_state set market_up_to_block = $1, market_up_to_time = $2",
		[BLOCK.toString(), TIME.toString()],
	);
	return pool;
}

async function list(
	pool: pg.Pool,
	l: { id: number; block: number; buyable: boolean; tokenId?: number },
) {
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
		   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
		 values ($1, $2, true, $3, $4, $5, 53800000000000000000, 100, $6, $7, $2, $8, 1, 150, 1578, 0, 330)`,
		[
			l.id,
			BLOCK.toString(),
			SELLER,
			PROCESSOR,
			l.tokenId ?? 2421,
			l.block,
			1_795_000_000 + l.block - 134_800_000,
			l.buyable,
		],
	);
}

describe.skipIf(!TEST_DATABASE_URL)("a circuit's open listing", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("reads back as its ask in BNB, when it was listed, whether it can be bought, and the market's block", async () => {
		pool = await marketAt();
		await list(pool, { id: 28074, block: 134_850_000, buyable: true });
		expect(await readCircuitListing(pool, circuit)).toEqual({
			listingId: 28074n,
			seller: SELLER,
			ask: { currency: "BNB", value: 53_800_000_000_000_000_000n },
			listedAt: { block: 134_850_000n, time: 1_795_050_000n },
			buyable: true,
			readAt: { chainId: 56, block: BLOCK, time: TIME },
		});
	});

	test("a circuit with no open listing has none", async () => {
		pool = await marketAt();
		await list(pool, {
			id: 28074,
			block: 134_850_000,
			buyable: true,
			tokenId: 9,
		});
		expect(await readCircuitListing(pool, circuit)).toBeNull();
	});

	test("with two open listings, the newest one that can be bought", async () => {
		pool = await marketAt();
		await list(pool, { id: 28000, block: 134_850_000, buyable: true });
		await list(pool, { id: 28074, block: 134_860_000, buyable: false });
		await list(pool, { id: 27000, block: 134_840_000, buyable: true });
		expect((await readCircuitListing(pool, circuit))?.listingId).toBe(28000n);
	});

	test("refuses before the market index is filled", async () => {
		pool = await emptyIndexAt(BLOCK);
		await expect(readCircuitListing(pool, circuit)).rejects.toThrow(
			"not filled",
		);
	});
});
