import { readNetworkState } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import { isFabxPage, parseAddress } from "@foreman/contract";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { loadResultContext } from "../result.ts";
import { NOT_VALUED_REASON, readCircuitPage } from "./circuit-page.ts";
import { readListingsPage } from "./listings-page.ts";
import {
	MINE6,
	P0,
	PAGE_CIRCUITS,
	pageIndex,
	TEST_LISTING,
} from "./page-fixture.ts";

// The listings page (docs/data-contract.md, ListingsPage) on the result page's fixture index: its
// stored results, the market at BNB block 134,900,065 with the network the follow stores there
// (2026-11-22-market-network.md), and the page fixture's one listing (28,200, MINE6/2683, its
// miner's state read from chain data). The other five listings and their miner states are made up
// by this test, to cover the rules; their circuits and stored results are the fixture's.

const MARKET = {
	block: BigInt(fixture.market.block),
	time: BigInt(fixture.market.time),
};
const OTHER_SELLER = `0x${"ab".repeat(20)}`;

/** A made-up open listing with a made-up miner state at the market block. */
interface MadeUp {
	listingId: number;
	processor: string;
	id: number;
	/** Blocks before the market block it was listed. */
	listedAgo: number;
	buyable: boolean;
	/** getMiner's status and task, and the weight in its pool; null for no state read. */
	miner: { status: number; taskId: number; weight: bigint } | null;
	seller?: string;
}

const MADE_UP: MadeUp[] = [
	// A copy, mining in the verified pool, the newest listing
	{
		listingId: 28_201,
		processor: MINE6,
		id: 2510,
		listedAgo: 50,
		buyable: true,
		miner: { status: 1, taskId: 220, weight: 61n },
	},
	// Too small to tell, cooling: in every open listing, never in the mining set
	{
		listingId: 28_202,
		processor: MINE6,
		id: 128,
		listedAgo: 150,
		buyable: true,
		miner: { status: 3, taskId: 0, weight: 0n },
	},
	// Mining in the unverified pool: in the mining set, not valued
	{
		listingId: 28_203,
		processor: MINE6,
		id: 1,
		listedAgo: 200,
		buyable: true,
		miner: { status: 1, taskId: 0, weight: 7n },
	},
	// Mining, but a buy would revert: not in the mining set
	{
		listingId: 28_204,
		processor: MINE6,
		id: 46,
		listedAgo: 250,
		buyable: false,
		miner: { status: 1, taskId: 220, weight: 12n },
		seller: OTHER_SELLER,
	},
	// A circuit with no stored result, never mined
	{
		listingId: 28_205,
		processor: P0,
		id: 6534,
		listedAgo: 300,
		buyable: true,
		miner: { status: 0, taskId: 0, weight: 0n },
	},
];

async function insert(pool: pg.Pool, l: MadeUp) {
	const verified = l.miner !== null && l.miner.taskId !== 0;
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
		   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
		 values ($1, $2, true, $3, $4, $5, $6, 100, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		[
			l.listingId,
			MARKET.block.toString(),
			l.seller ?? TEST_LISTING.seller,
			l.processor,
			l.id,
			(10n ** 17n).toString(),
			(MARKET.block - BigInt(l.listedAgo)).toString(),
			(MARKET.time - BigInt(l.listedAgo)).toString(),
			l.miner ? MARKET.block.toString() : null,
			l.buyable,
			l.miner?.status ?? null,
			l.miner?.taskId ?? null,
			l.miner ? (verified ? l.miner.weight : 0n).toString() : null,
			l.miner ? (verified ? 0n : l.miner.weight).toString() : null,
			l.miner ? (l.miner.status === 1 ? l.miner.weight : 0n).toString() : null,
		],
	);
}

async function setUp(options: { storeNetwork?: boolean } = {}) {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: MARKET,
		networkDays: fixture.networkDays,
	});
	for (const l of MADE_UP) await insert(pool, l);
	if (options.storeNetwork ?? true) {
		const n = await readNetworkState(replayClient(fixture.bnb), {
			blockNumber: MARKET.block,
		});
		await pool.query(
			`update index_state set market_verified_weight = $1, market_unverified_weight = $2,
			   market_miner_count = $3, market_verified_miner_count = $4`,
			[
				n.verifiedWeight,
				n.unverifiedWeight,
				n.minerCount,
				n.verifiedMinerCount,
			].map(String),
		);
	}
	return pool;
}

const ids = (rows: { listing: { listingId: bigint } }[]) =>
	rows.map((r) => Number(r.listing.listingId));

describe.skipIf(!TEST_DATABASE_URL)("the listings page", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("the mining set: listings that can be bought whose miner is active, newest first, each valued or saying why not", async () => {
		pool = await setUp();
		const read = await readListingsPage(pool, {
			set: "mining",
			verdict: null,
			cursor: null,
		});
		if (!read.ok) throw new Error(read.error.detail);
		const { page } = read;
		expect(ids(page.rows)).toEqual([28_201, 28_200, 28_203]);
		expect(page.rows.map((r) => r.value30d.state)).toEqual([
			"shown",
			"shown",
			"not-valued",
		]);
		expect(page.rows[2]?.value30d).toEqual({
			state: "not-valued",
			reason: NOT_VALUED_REASON,
		});
		expect(page.rows.map((r) => r.multiplier)).toEqual([6, 6, 6]);
		expect(page.counts).toEqual({
			open: 6,
			buyable: 5,
			sellers: 2,
			bySet: { mining: 3, all: 6 },
			byVerdict: {
				"no-earlier-copy": 2,
				copy: 1,
				"too-small-to-tell": 0,
				wrapper: 0,
				"cant-check": 0,
				"not-checked": 0,
			},
		});
		expect(page.market.upTo).toEqual({ chainId: 56, ...MARKET });
		expect(page.next).toBeNull();
	});

	test("a listing's 30-day value, from its stored weight and the network stored with the market, is the result page's 30-day value for the same miner", async () => {
		pool = await setUp();
		const read = await readListingsPage(pool, {
			set: "mining",
			verdict: null,
			cursor: null,
		});
		if (!read.ok) throw new Error(read.error.detail);
		const listed = read.page.rows.find(
			(r) => r.listing.listingId === TEST_LISTING.listingId,
		);
		const live = await readCircuitPage(
			{
				pool,
				bnb: replayClient(fixture.bnb),
				xlayer: replayClient(fixture.xlayer),
				results: {
					chainId: 1952,
					address: parseAddress(
						"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
						"c",
					),
				},
				resultContext: () =>
					loadResultContext(pool as pg.Pool, replayClient(circuits)),
			},
			PAGE_CIRCUITS.mining,
		);
		if (!live.ok) throw new Error(live.error.detail);
		if (isFabxPage(live.page) || live.page.hold.state !== "shown")
			throw new Error("the page's miner isn't valued");
		expect(listed?.value30d).toEqual({
			state: "shown",
			valuation: live.page.hold.thirtyDays,
		});
	});

	test('every open listing: a stopped miner is not mining, and a circuit with no stored result is not checked, never "no earlier copy"', async () => {
		pool = await setUp();
		const read = await readListingsPage(pool, {
			set: "all",
			verdict: null,
			cursor: null,
		});
		if (!read.ok) throw new Error(read.error.detail);
		const { page } = read;
		expect(ids(page.rows)).toEqual([
			28_201, 28_200, 28_202, 28_203, 28_204, 28_205,
		]);
		const byId = (id: number) =>
			page.rows.find((r) => Number(r.listing.listingId) === id);
		expect(byId(28_202)?.value30d).toEqual({ state: "not-mining" });
		expect(byId(28_205)?.check.state).toBe("not-checked");
		expect(byId(28_205)?.multiplier).toBe(0);
		expect(page.counts.byVerdict).toEqual({
			"no-earlier-copy": 3,
			copy: 1,
			"too-small-to-tell": 1,
			wrapper: 0,
			"cant-check": 0,
			"not-checked": 1,
		});
	});

	test("the verdict filter shows only that verdict and leaves the set's counts as they were", async () => {
		pool = await setUp();
		const all = await readListingsPage(pool, {
			set: "all",
			verdict: null,
			cursor: null,
		});
		const copies = await readListingsPage(pool, {
			set: "all",
			verdict: "copy",
			cursor: null,
		});
		if (!all.ok || !copies.ok) throw new Error("page not read");
		expect(ids(copies.page.rows)).toEqual([28_201]);
		expect(copies.page.counts).toEqual(all.page.counts);
	});

	test("pages of 50, newest first, each listing once, the last with no cursor", async () => {
		pool = await setUp();
		// 50 more made-up listings of P0/1 (no stored result), two of them in the same block
		for (let i = 0; i < 50; i++) {
			await insert(pool, {
				listingId: 28_300 + i,
				processor: P0,
				id: 1,
				listedAgo: 1_000 + Math.floor(i / 2) * 2,
				buyable: true,
				miner: { status: 0, taskId: 0, weight: 0n },
			});
		}
		const first = await readListingsPage(pool, {
			set: "all",
			verdict: null,
			cursor: null,
		});
		if (!first.ok) throw new Error(first.error.detail);
		expect(first.page.rows).toHaveLength(50);
		expect(first.page.next).not.toBeNull();
		const second = await readListingsPage(pool, {
			set: "all",
			verdict: null,
			cursor: first.page.next,
		});
		if (!second.ok) throw new Error(second.error.detail);
		expect(second.page.next).toBeNull();
		const seen = [...ids(first.page.rows), ...ids(second.page.rows)];
		expect(seen).toHaveLength(56);
		expect(new Set(seen).size).toBe(56);
	});

	test("before the network is stored at the market's block, the page is not ready, never valued at zero", async () => {
		pool = await setUp({ storeNetwork: false });
		const read = await readListingsPage(pool, {
			set: "mining",
			verdict: null,
			cursor: null,
		});
		expect(read).toMatchObject({ ok: false, error: { error: "not-ready" } });
	});

	test("a cursor this API didn't give is not recognised", async () => {
		pool = await setUp();
		const read = await readListingsPage(pool, {
			set: "all",
			verdict: null,
			cursor: "page-2",
		});
		expect(read).toMatchObject({
			ok: false,
			error: { error: "not-recognised" },
		});
	});
});
