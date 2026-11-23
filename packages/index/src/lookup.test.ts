import { parseHex32 } from "@foreman/contract";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { findListingCircuit, findMinerCircuit } from "./index.ts";
import { emptyIndexAt, TEST_DATABASE_URL } from "./testing.ts";

// The Check box's listing numbers (docs/decisions/2026-11-22-check-box-input.md): an open or sold
// listing finds its circuit; a withdrawn one and one the market hasn't seen say so, never a guess.

const BLOCK = 134_895_911n;
const TIME = 1_795_268_036n;
const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const SELLER = `0x${"fd".repeat(20)}`;
const BUYER = `0x${"ab".repeat(20)}`;

async function marketAt() {
	const pool = await emptyIndexAt(BLOCK);
	await pool.query(
		"update index_state set market_up_to_block = $1, market_up_to_time = $2",
		[BLOCK.toString(), TIME.toString()],
	);
	return pool;
}

async function listOpen(pool: pg.Pool, id: number, tokenId: number) {
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
		   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
		 values ($1, $2, true, $3, $4, $5, 53800000000000000000, 100, 134850000, 1795050000, $2, true, 1, 150, 1578, 0, 330)`,
		[id, BLOCK.toString(), SELLER, PROCESSOR, tokenId],
	);
}

async function listClosed(pool: pg.Pool, id: number) {
	await pool.query(
		"insert into market_listings (listing_id, read_at_block, open) values ($1, $2, false)",
		[id, BLOCK.toString()],
	);
}

async function sell(pool: pg.Pool, id: number, tokenId: number) {
	await pool.query(
		`insert into market_sales (block, log_index, tx, time, listing_id, processor, token_id, buyer, price_wei, fee_wei)
		 values (134800000, 7, $1, 1795000000, $2, $3, $4, $5, 1000000000000000000, 10000000000000000)`,
		[`0x${"12".repeat(32)}`, id, PROCESSOR, tokenId, BUYER],
	);
}

describe.skipIf(!TEST_DATABASE_URL)(
	"finding a listing number's circuit",
	() => {
		let pool: pg.Pool | undefined;
		afterEach(async () => {
			await pool?.end();
		});

		test("an open listing finds its circuit", async () => {
			pool = await marketAt();
			await listOpen(pool, 28074, 2421);
			expect(await findListingCircuit(pool, 28074n)).toEqual({
				found: true,
				state: "open",
				circuit: { processor: PROCESSOR, id: 2421n },
			});
		});

		test("a sold listing finds the circuit its Sold event names", async () => {
			pool = await marketAt();
			await listClosed(pool, 27000);
			await sell(pool, 27000, 13056);
			expect(await findListingCircuit(pool, 27000n)).toEqual({
				found: true,
				state: "sold",
				circuit: { processor: PROCESSOR, id: 13056n },
			});
		});

		test("a withdrawn listing is withdrawn, with the market's block, never a guessed circuit", async () => {
			pool = await marketAt();
			await listClosed(pool, 26000);
			expect(await findListingCircuit(pool, 26000n)).toEqual({
				found: false,
				reason: "withdrawn",
				marketBlock: BLOCK,
			});
		});

		test("a listing the market hasn't seen is no such listing, up to the market's block", async () => {
			pool = await marketAt();
			expect(await findListingCircuit(pool, 99999n)).toEqual({
				found: false,
				reason: "no-such-listing",
				marketBlock: BLOCK,
			});
		});

		test("before the market's first fill it refuses rather than say no such listing", async () => {
			pool = await emptyIndexAt(BLOCK);
			await expect(findListingCircuit(pool, 28074n)).rejects.toThrow(
				/not filled/,
			);
		});
	},
);

describe.skipIf(!TEST_DATABASE_URL)("finding a miner key's circuit", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});
	const KEY = parseHex32(`0x${"72".repeat(32)}`, "key");

	async function minersAt() {
		const pool = await emptyIndexAt(BLOCK);
		await pool.query("update index_state set miners_up_to_block = $1", [
			BLOCK.toString(),
		]);
		await pool.query(
			`insert into miners (key, processor, id, first_started_block, last_started_block,
			   last_started_tx, last_started_log, starts)
			 values (decode($1, 'hex'), $2, 2421, 122175300, 122175300, 1, 1, 1)`,
			[KEY.slice(2), PROCESSOR],
		);
		return pool;
	}

	test("a miner in the index finds its circuit", async () => {
		pool = await minersAt();
		expect(await findMinerCircuit(pool, KEY)).toEqual({
			found: true,
			circuit: { processor: PROCESSOR, id: 2421n },
		});
	});

	test("a key the index doesn't hold is not found, up to the miners' block", async () => {
		pool = await minersAt();
		expect(
			await findMinerCircuit(pool, parseHex32(`0x${"99".repeat(32)}`, "key")),
		).toEqual({
			found: false,
			minersBlock: BLOCK,
		});
	});

	test("before the miners are read it refuses rather than say not found", async () => {
		pool = await emptyIndexAt(BLOCK);
		await expect(findMinerCircuit(pool, KEY)).rejects.toThrow(/not read/);
	});
});
