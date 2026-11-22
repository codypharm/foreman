import { replayClient } from "@foreman/chain-bnb/fixture";
import { readResultsState, readStoredResult } from "@foreman/index";
import {
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { createPublicClient, custom } from "viem";
import { afterEach, describe, expect, test } from "vitest";
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
async function fixtureIndex() {
	const pool = await fixtureIndexedDatabase();
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
