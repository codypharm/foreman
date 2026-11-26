import { replayClient } from "@foreman/chain-bnb/fixture";
import { readResultsState, readStoredResult } from "@foreman/index";
import {
	fabxIndexedDatabase,
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { createPublicClient, custom } from "viem";
import { afterEach, describe, expect, test } from "vitest";
import { storedResultsToPublish } from "../publish/collect.ts";
import { buildResult, loadResultContext } from "../result.ts";
import { refreshResults } from "./refresh.ts";

// The results job (docs/decisions/2026-11-21-stored-results.md) on the originality fixture's index
// at block 134,673,279: its 16 miners, plus one listed circuit when a test lists it.

const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const INDEX_BLOCK = 134_673_279n;
const NOW = 1_795_200_000n;
const HOUR = 3_600n;

/**
 * The fixture's index with MINE6/1965's real Revoked event (block 118,590,677, transaction 2,
 * log 5, test vector 140; packages/originality/fixtures/README.md), which the fixture database
 * leaves out. Without it that miner's result can't be built.
 */
async function fixtureIndex(withFabx = false) {
	const pool = withFabx
		? await fabxIndexedDatabase()
		: await fixtureIndexedDatabase();
	await pool.query(
		`update miners set revoked_block = 118590677, revoked_tx = 2, revoked_log = 5,
		   revoked_vector = 140 where processor = $1 and id = 1965`,
		[MINE6],
	);
	return pool;
}

/** Lists the fixture's pure wrapper P0/6534, which isn't a miner. */
async function listWrapper(pool: pg.Pool) {
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps, listed_block, listed_time)
		 values (1, $1, true, $2, $3, 6534, 1, 100, $1, 1)`,
		[INDEX_BLOCK.toString(), `0x${"fd".repeat(20)}`, P0],
	);
}

/** Every stored result, in circuit order. */
async function storedRows(pool: pg.Pool) {
	return (
		await pool.query(
			"select processor, id, kind, can_mine, originality, index_block from circuit_results order by processor, id",
		)
	).rows;
}

/** Multicall3 on BNB Chain (CLAUDE.md "On-chain facts"). */
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

/** A node that refuses every call: every build fails. */
const deadClient = createPublicClient({
	transport: custom({
		async request() {
			throw new Error("node down");
		},
	}),
});

describe.skipIf(!TEST_DATABASE_URL)("the results job", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("the first run is a full rebuild: every miner and listed circuit stored, as the builder makes it", async () => {
		pool = await fixtureIndex();
		await listWrapper(pool);
		const client = replayClient(circuits);
		const run = await refreshResults(pool, client, { mode: "auto", now: NOW });
		expect(run).toMatchObject({
			refreshed: true,
			mode: "full",
			indexBlock: INDEX_BLOCK,
			built: 17,
			skipped: [],
			removed: 0,
		});
		const loaded = await loadResultContext(pool, client);
		if (!loaded.ready) throw new Error(loaded.detail);
		const built = await buildResult(
			loaded.context,
			{ processor: MINE6, id: 2510n },
			"miner",
		);
		if (!built.ok) throw new Error(built.detail);
		expect(
			await readStoredResult(pool, { processor: MINE6, id: 2510n }),
		).toEqual({
			originality: built.originality,
			indexBlock: INDEX_BLOCK,
			builtAt: NOW,
		});
		expect(
			(await readStoredResult(pool, { processor: P0, id: 6534n }))?.originality
				.scope,
		).toBe("listed");
	});

	test("reads bundled into Multicall3 calls store the same results as reads one by one", async () => {
		// docs/decisions/2026-11-22-results-reads-multicall.md
		pool = await fixtureIndex();
		await listWrapper(pool);
		await refreshResults(pool, replayClient(circuits), {
			mode: "full",
			now: NOW,
		});
		const oneByOne = await storedRows(pool);
		await pool.query("delete from circuit_results");
		const asked: string[] = [];
		const run = await refreshResults(
			pool,
			replayClient(circuits, { multicall: true, asked }),
			{ mode: "full", now: NOW },
		);
		expect(run).toMatchObject({ refreshed: true, built: 17, skipped: [] });
		expect(asked).toContain(`eth_call:${MULTICALL3}`);
		expect(await storedRows(pool)).toEqual(oneByOne);
	});

	test("within the hour, a run rebuilds only what the follow touched", async () => {
		pool = await fixtureIndex();
		const client = replayClient(circuits);
		await refreshResults(pool, client, { mode: "auto", now: NOW });
		const quiet = await refreshResults(pool, client, {
			mode: "auto",
			now: NOW + 300n,
		});
		expect(quiet).toMatchObject({ mode: "changes", built: 0, removed: 0 });

		await listWrapper(pool);
		const listed = await refreshResults(pool, client, {
			mode: "auto",
			now: NOW + 600n,
		});
		// The new listing has no row yet, so it's built though nothing moved past the block
		expect(listed).toMatchObject({ mode: "changes", built: 1 });
		expect(await readResultsState(pool)).toEqual({
			changesUpTo: INDEX_BLOCK,
			fullUpTo: INDEX_BLOCK,
			fullAt: NOW,
			fabxChangesUpTo: null,
		});
	});

	test("after an hour, a run is a full rebuild again", async () => {
		pool = await fixtureIndex();
		const client = replayClient(circuits);
		await refreshResults(pool, client, { mode: "auto", now: NOW });
		const run = await refreshResults(pool, client, {
			mode: "auto",
			now: NOW + HOUR,
		});
		expect(run).toMatchObject({ mode: "full", built: 16 });
		expect((await readResultsState(pool)).fullAt).toBe(NOW + HOUR);
	});

	test("a circuit that is no longer listed or a miner loses its row", async () => {
		pool = await fixtureIndex();
		await listWrapper(pool);
		const client = replayClient(circuits);
		await refreshResults(pool, client, { mode: "auto", now: NOW });
		await pool.query(
			`update market_listings set open = false, seller = null, processor = null, token_id = null,
			   price_wei = null, fee_bps = null where listing_id = 1`,
		);
		const run = await refreshResults(pool, client, {
			mode: "auto",
			now: NOW + 300n,
		});
		expect(run).toMatchObject({ removed: 1 });
		expect(
			await readStoredResult(pool, { processor: P0, id: 6534n }),
		).toBeNull();
	});

	test("a failed build keeps the circuit's last complete row and says why", async () => {
		pool = await fixtureIndex();
		await refreshResults(pool, replayClient(circuits), {
			mode: "auto",
			now: NOW,
		});
		const run = await refreshResults(pool, deadClient, {
			mode: "full",
			now: NOW + HOUR,
		});
		expect(run).toMatchObject({ refreshed: true, built: 0 });
		if (!run.refreshed) throw new Error(run.detail);
		expect(run.skipped).toHaveLength(16);
		expect(
			(await readStoredResult(pool, { processor: MINE6, id: 2510n }))?.builtAt,
		).toBe(NOW);
		// Nothing moved: the next run tries the full rebuild again
		expect((await readResultsState(pool)).fullAt).toBe(NOW);
	});
});

// FabX's five circuits beside the fixture's index (@foreman/index/testing, fabxIndexedDatabase):
// miners #24, #66, #1961 and #4206, and the wrapper #6147, which isn't a miner.
const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";

describe.skipIf(!TEST_DATABASE_URL)("the results job with FabX", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});
	const fabxRows = async (p: pg.Pool) =>
		(
			await p.query<{ id: string; built_at: string }>(
				"select id::text, built_at::text from circuit_results where processor = $1 order by circuit_results.id",
				[FABX],
			)
		).rows;

	test("stores every FabX miner's result, never a FabX circuit that isn't a miner, and publishes none of them yet", async () => {
		pool = await fixtureIndex(true);
		const run = await refreshResults(pool, replayClient(circuits), {
			mode: "auto",
			now: NOW,
		});
		if (!run.refreshed) throw new Error(run.detail);
		expect(run.skipped).toEqual([]);
		expect((await fabxRows(pool)).map((r) => r.id)).toEqual([
			"24",
			"66",
			"1961",
			"4206",
		]);
		expect(
			(await readStoredResult(pool, { processor: FABX, id: 66n }))?.originality
				.mining,
		).toEqual({
			chainId: 196,
			contract: "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265",
		});
		expect((await readResultsState(pool)).fabxChangesUpTo).toBe(76_847_895n);
		// FabX publishing is its own step: key collisions are refused first (2026-11-25-fabx-copy-check.md, decision 7)
		const { results } = await storedResultsToPublish(pool);
		expect(results.some((o) => o.circuit.chainId === 196)).toBe(false);
	});

	test("while FabX is frozen, its stored results are neither rebuilt nor removed; BNB Chain's carry on", async () => {
		pool = await fixtureIndex(true);
		await refreshResults(pool, replayClient(circuits), {
			mode: "auto",
			now: NOW,
		});
		const before = await fabxRows(pool);
		await pool.query("update xlayer_state set frozen_at_block = 76847896");
		const run = await refreshResults(pool, replayClient(circuits), {
			mode: "full",
			now: NOW + HOUR,
		});
		if (!run.refreshed) throw new Error(run.detail);
		expect(await fabxRows(pool)).toEqual(before);
		expect(run.built).toBe(16);
	});
});
