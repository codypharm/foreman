import { minerKey } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import {
	type BnbCircuitPage,
	isFabxPage,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import { readStoredResult, recordPublished } from "@foreman/index";
import { fabxIndexedDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { createPublicClient, custom, type PublicClient } from "viem";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { planEntry } from "../publish/plan.ts";
import { loadResultContext } from "../result.ts";
import { refreshResults } from "../results/refresh.ts";
import { type PageDeps, readCircuitPage } from "./circuit-page.ts";
import { PAGE_CIRCUITS, pageIndex, TEST_LISTING } from "./page-fixture.ts";

// The result page (docs/data-contract.md, CircuitPage; 2026-11-21-circuit-page-reads.md) on the
// originality fixture's index, with the market index at BNB block 134,900,065 (21 Nov 2026),
// recorded by scripts/record-page-fixture.ts. See fixtures/README.md.

const MARKET = {
	block: BigInt(fixture.market.block),
	time: BigInt(fixture.market.time),
};
const TESTNET = {
	chainId: 1952 as const,
	address: parseAddress("0xe1b2343d3da66afec740c0fcaf40a701e2d513e8", "c"),
};

/** A node that refuses every call. */
const deadClient = createPublicClient({
	transport: custom({
		async request() {
			throw new Error("node down");
		},
	}),
});

async function setUp(bnb: PublicClient = replayClient(fixture.bnb)) {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: MARKET,
		networkDays: fixture.networkDays,
	});
	const deps: PageDeps = {
		pool,
		bnb,
		xlayer: replayClient(fixture.xlayer),
		results: TESTNET,
		resultContext: () => loadResultContext(pool, replayClient(circuits)),
	};
	return { pool, deps };
}

/** A BNB Chain circuit's page, or the test fails. */
async function bnbPage(
	deps: PageDeps,
	circuit: Parameters<typeof readCircuitPage>[1],
): Promise<BnbCircuitPage> {
	const read = await readCircuitPage(deps, circuit);
	if (!read.ok) throw new Error(read.error.detail);
	if (isFabxPage(read.page)) throw new Error("a FabX page");
	return read.page;
}

describe.skipIf(!TEST_DATABASE_URL)("the result page", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("a mining miner with a listing: its stored result, value and payback, and every BNB part read at the market index's block", async () => {
		const set = await setUp();
		pool = set.pool;
		const read = { page: await bnbPage(set.deps, PAGE_CIRCUITS.mining) };
		const { page } = read;
		const stored = await readStoredResult(pool, PAGE_CIRCUITS.mining);
		expect(page.check).toEqual({
			state: "checked",
			originality: stored?.originality,
		});
		expect(page.multiplier).toBe(6);
		expect(page.published).toEqual({
			state: "not-published",
			reason: "not-yet",
		});
		expect(page.miner).toMatchObject({ status: "active", pool: "verified" });
		expect(page.listing).toMatchObject({
			listingId: TEST_LISTING.listingId,
			ask: { currency: "BNB", value: TEST_LISTING.priceWei },
			buyable: true,
		});
		expect(page.hold.state).toBe("shown");
		expect(page.payback).toMatchObject({
			state: "shown",
			listingId: TEST_LISTING.listingId,
		});
		// One moment on BNB Chain: the market index's block
		const blocks = [
			page.miner?.readAt.block,
			page.listing?.readAt.block,
			page.payback.readAt.block,
			"readAt" in page.bemPrice ? page.bemPrice.readAt.block : null,
			page.hold.state === "shown"
				? page.hold.thirtyDays.inputs.networkWeight
				: null,
		];
		expect(blocks.slice(0, 4)).toEqual(Array(4).fill(MARKET.block));
		expect(blocks[4]).toMatchObject({ block: MARKET.block });
		expect(page.options.sell.bid).toEqual({
			state: "none",
			checkedAt: MARKET.time,
		});
		expect(page.options.rent).toEqual({
			option: "rent",
			minerKey: minerKey(PAGE_CIRCUITS.mining),
			state: "no-venue",
		});
		// No RIG voucher names it: Lend says so for both terms
		expect(page.voucher).toBeNull();
		expect(page.options.lend.map((l) => l.state)).toEqual(["none", "none"]);
	});

	test("published: current when the stored result is the one on the results contract, older when it changed since", async () => {
		const set = await setUp();
		pool = set.pool;
		const stored = await readStoredResult(pool, PAGE_CIRCUITS.mining);
		if (!stored) throw new Error("no stored result");
		const entry = planEntry(stored.originality);
		const at = {
			tx: parseHex32(`0x${"52".repeat(32)}`, "tx"),
			block: 46_803_541n,
		};
		await recordPublished(pool, TESTNET, [entry], at);
		const current = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		expect(current.ok && current.page.published).toEqual({
			state: "current",
			publishedAt: { chainId: 1952, ...at },
			contract: TESTNET.address,
			resultHash: entry.resultHash,
		});

		// Published from an earlier check with the same verdict, evidence and can-mine state: a later
		// index block changes the hash, not the fingerprint (2026-11-23-same-verdict-read-back.md)
		const earlier = parseHex32(`0x${"cd".repeat(32)}`, "hash");
		await recordPublished(
			pool,
			TESTNET,
			[{ ...entry, resultHash: earlier }],
			at,
		);
		const same = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		expect(same.ok && same.page.published).toMatchObject({
			state: "older",
			verdict: "same",
			resultHash: earlier,
		});

		// A different fingerprint: the verdict changed, and the next publish replaces it
		await recordPublished(
			pool,
			TESTNET,
			[
				{
					...entry,
					resultHash: earlier,
					fingerprint: parseHex32(`0x${"ef".repeat(32)}`, "fingerprint"),
				},
			],
			at,
		);
		const changed = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		expect(changed.ok && changed.page.published).toMatchObject({
			state: "older",
			verdict: "changed",
		});
	});

	test("a stopped miner has no value and no payback, never a zero", async () => {
		const set = await setUp();
		pool = set.pool;
		const read = { page: await bnbPage(set.deps, PAGE_CIRCUITS.cooling) };
		expect(read.page.miner?.status).toBe("cooling");
		expect(read.page.listing).toBeNull();
		expect(read.page.hold).toEqual({ state: "not-mining" });
		expect(read.page.payback.state).toBe("not-mining");
		expect(read.page.options.sell.sales.range).toEqual({ state: "not-mining" });
	});

	test("a circuit that is neither a miner nor listed is checked on request as pasted, and never published", async () => {
		const set = await setUp();
		pool = set.pool;
		const read = { page: await bnbPage(set.deps, PAGE_CIRCUITS.pasted) };
		expect(read.page.check).toMatchObject({
			state: "checked",
			originality: { scope: "pasted", result: { verdict: "wrapper" } },
		});
		expect(read.page.published).toEqual({
			state: "not-published",
			reason: "pasted",
		});
		expect(read.page.miner).toBeNull();
		expect(read.page.multiplier).toBe(0);
		expect(read.page.hold).toEqual({ state: "not-mining" });
		// Building it on request stores nothing
		expect(await readStoredResult(pool, PAGE_CIRCUITS.pasted)).toBeNull();
	});

	test("a miner with no stored result yet is 'not checked', never a verdict built in its place", async () => {
		const set = await setUp();
		pool = set.pool;
		await pool.query(
			"delete from circuit_results where processor = $1 and id = $2",
			[PAGE_CIRCUITS.mining.processor, PAGE_CIRCUITS.mining.id.toString()],
		);
		const read = { page: await bnbPage(set.deps, PAGE_CIRCUITS.mining) };
		expect(read.page.check).toEqual({
			state: "not-checked",
			detail: "Foreman hasn't checked this circuit yet",
		});
		expect(read.page.published).toEqual({
			state: "not-published",
			reason: "not-yet",
		});
	});

	test("a circuit outside the index is unknown-circuit", async () => {
		const set = await setUp();
		pool = set.pool;
		const read = await readCircuitPage(set.deps, {
			processor: PAGE_CIRCUITS.mining.processor,
			id: 999_999n,
		});
		expect(read).toMatchObject({
			ok: false,
			error: { error: "unknown-circuit" },
		});
	});

	test("a failed BNB read is read-failed, never a partial page", async () => {
		const set = await setUp(deadClient);
		pool = set.pool;
		const read = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		expect(read).toEqual({
			ok: false,
			error: { error: "read-failed", detail: expect.any(String) },
		});
	});

	test("before the market index is filled: not-ready", async () => {
		const set = await setUp();
		pool = set.pool;
		await pool.query(
			"update index_state set market_up_to_block = null, market_up_to_time = null",
		);
		const read = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		expect(read).toMatchObject({ ok: false, error: { error: "not-ready" } });
	});
});

// A FabX circuit's page (2026-11-26-fabx-circuit-page.md) on FabX's five circuits beside the
// fixture's index (@foreman/index/testing, fabxIndexedDatabase): miners #24, #66, #1961 and #4206,
// and the wrapper #6147, which isn't a miner. Everything comes from what is stored with FabX's
// history, so both nodes refuse every call.
const FABX = parseAddress("0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6", "p");
const FABX_MINING = "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265";

async function fabxSetUp() {
	const pool = await fabxIndexedDatabase();
	await refreshResults(pool, replayClient(circuits), {
		mode: "full",
		now: 1_795_200_000n,
	});
	const deps: PageDeps = {
		pool,
		bnb: deadClient,
		xlayer: deadClient,
		results: TESTNET,
		resultContext: () => loadResultContext(pool, replayClient(circuits)),
	};
	return { pool, deps };
}

describe.skipIf(!TEST_DATABASE_URL)("a FabX circuit's result page", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("a FabX miner: its stored result, FabX's miner record and FabX's state, with no live read", async () => {
		const set = await fabxSetUp();
		pool = set.pool;
		const read = await readCircuitPage(set.deps, { processor: FABX, id: 24n });
		if (!read.ok) throw new Error(read.error.detail);
		const page = read.page;
		if (!isFabxPage(page)) throw new Error("not a FabX page");
		const stored = await readStoredResult(pool, { processor: FABX, id: 24n });
		expect(page.check).toEqual({
			state: "checked",
			originality: stored?.originality,
		});
		expect(page.miner).toEqual({
			taskId: expect.any(Number),
			readAtBlock: 76_847_895n,
		});
		expect(page.fabx).toEqual({
			contract: FABX_MINING,
			followedTo: 76_847_895n,
			frozenAtBlock: null,
		});
		expect(page.published).toEqual({
			state: "not-published",
			reason: "not-yet",
		});
	});

	test("while FabX is frozen, the page carries the block it froze at and its last stored result", async () => {
		const set = await fabxSetUp();
		pool = set.pool;
		await pool.query("update xlayer_state set frozen_at_block = 76847896");
		const read = await readCircuitPage(set.deps, { processor: FABX, id: 24n });
		if (!read.ok) throw new Error(read.error.detail);
		expect(isFabxPage(read.page) && read.page.fabx.frozenAtBlock).toBe(
			76_847_896n,
		);
		expect(read.page.check.state).toBe("checked");
	});

	test("a FabX circuit that isn't a miner is checked on request as pasted, with no miner record", async () => {
		const set = await fabxSetUp();
		pool = set.pool;
		const read = await readCircuitPage(set.deps, {
			processor: FABX,
			id: 6147n,
		});
		if (!read.ok) throw new Error(read.error.detail);
		const page = read.page;
		if (!isFabxPage(page)) throw new Error("not a FabX page");
		expect(page.miner).toBeNull();
		expect(page.check.state === "checked" && page.check.originality.scope).toBe(
			"pasted",
		);
		expect(page.published).toEqual({
			state: "not-published",
			reason: "pasted",
		});
	});
});
