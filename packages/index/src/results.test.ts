import {
	type Originality,
	parseOriginality,
	serialiseOriginality,
} from "@foreman/contract";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	circuitsTouchedSince,
	readResultsState,
	readStoredResult,
	saveResults,
} from "./index.ts";
import {
	emptyIndexAt,
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "./testing.ts";

// The stored results the API reads (docs/decisions/2026-11-21-stored-results.md). Made-up results:
// only the storage is under test; building them is the API's job.

const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

function result(
	tokenId: string,
	indexBlock: string,
	scope: "miner" | "listed" | "pasted" = "miner",
): Originality {
	return parseOriginality(
		{
			circuit: {
				chainId: 56,
				processor: PROCESSOR,
				tokenId,
				tapedOutAt: {
					block: "122174306",
					txIndex: 3,
					logIndex: 7,
					time: "1789000000",
				},
				tapedOutBy: `0x${"12".repeat(20)}`,
				designCommittedAt: null,
			},
			scope,
			mining:
				scope === "miner"
					? {
							chainId: 56,
							contract: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
						}
					: null,
			result: {
				verdict: "no-earlier-copy",
				netlistHash: `0x${"ab".repeat(32)}`,
			},
			facts: [{ fact: "can-mine", state: "mining" }],
			occc: { status: "not-checked" },
			index: {
				circuitsChecked: "80290",
				upTo: [{ chainId: 56, block: indexBlock }],
			},
			ruleVersion: "hash 2026-11-20, floor 4, chain 10",
		},
		"result",
	);
}

const circuit = (id: bigint) => ({ processor: PROCESSOR as never, id });

describe.skipIf(!TEST_DATABASE_URL)("stored results", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("a saved result reads back as the same result, with its index block and when it was built", async () => {
		pool = await emptyIndexAt(134_895_911n);
		const saved = result("2421", "134895911");
		await saveResults(pool, {
			mode: "full",
			indexBlock: 134_895_911n,
			builtAt: 1_795_200_000n,
			results: [saved],
			remove: [],
		});
		const read = await readStoredResult(pool, circuit(2421n));
		expect(read).toEqual({
			originality: saved,
			indexBlock: 134_895_911n,
			builtAt: 1_795_200_000n,
		});
		// The wire form is what a reader re-checks
		if (!read) throw new Error("no row");
		expect(serialiseOriginality(read.originality, "o")).toEqual(
			serialiseOriginality(saved, "o"),
		);
	});

	test("a circuit with no row has no stored result: never a verdict by default", async () => {
		pool = await emptyIndexAt(134_895_911n);
		expect(await readStoredResult(pool, circuit(2421n))).toBeNull();
	});

	test("a rebuild replaces a row, drops the circuits that are no longer miners or listed, and moves its block", async () => {
		pool = await emptyIndexAt(134_895_911n);
		await saveResults(pool, {
			mode: "full",
			indexBlock: 134_800_000n,
			builtAt: 1_795_100_000n,
			results: [
				result("2421", "134800000"),
				result("1080", "134800000", "listed"),
			],
			remove: [],
		});
		await saveResults(pool, {
			mode: "changes",
			indexBlock: 134_895_911n,
			builtAt: 1_795_200_000n,
			results: [result("2421", "134895911")],
			remove: [circuit(1080n)],
		});
		expect((await readStoredResult(pool, circuit(2421n)))?.indexBlock).toBe(
			134_895_911n,
		);
		expect(await readStoredResult(pool, circuit(1080n))).toBeNull();
		// A rebuild of changes moves only its own block; the hourly full one moves both
		expect(await readResultsState(pool)).toEqual({
			changesUpTo: 134_895_911n,
			fullUpTo: 134_800_000n,
			fullAt: 1_795_100_000n,
		});
	});

	test("a partial rebuild saves its rows but moves no block, so the next run retries", async () => {
		pool = await emptyIndexAt(134_895_911n);
		await saveResults(pool, {
			mode: "partial",
			indexBlock: 134_895_911n,
			builtAt: 1_795_200_000n,
			results: [result("2421", "134895911")],
			remove: [],
		});
		expect((await readStoredResult(pool, circuit(2421n)))?.indexBlock).toBe(
			134_895_911n,
		);
		expect(await readResultsState(pool)).toEqual({
			changesUpTo: null,
			fullUpTo: null,
			fullAt: null,
		});
	});

	test.each([
		[
			"a pasted result, which is never stored",
			result("2421", "134895911", "pasted" as never),
		],
		["a result built at another block", result("2421", "134800000")],
	])("refuses %s, saving nothing", async (_why, bad) => {
		pool = await emptyIndexAt(134_895_911n);
		await expect(
			saveResults(pool, {
				mode: "full",
				indexBlock: 134_895_911n,
				builtAt: 1_795_200_000n,
				results: [result("1080", "134895911"), bad],
				remove: [],
			}),
		).rejects.toThrow();
		expect(await readStoredResult(pool, circuit(1080n))).toBeNull();
		expect((await readResultsState(pool)).changesUpTo).toBeNull();
	});

	test("refuses to save before the index is filled", async () => {
		const { freshDatabase } = await import("./testing.ts");
		pool = await freshDatabase();
		await expect(
			saveResults(pool, {
				mode: "full",
				indexBlock: 134_895_911n,
				builtAt: 1_795_200_000n,
				results: [result("1080", "134895911")],
				remove: [],
			}),
		).rejects.toThrow("not filled");
		expect(await readStoredResult(pool, circuit(1080n))).toBeNull();
	});
});

// The originality fixture's index (packages/originality/fixtures/README.md): miner 2510 on the ×6
// processor is a copy of 2683, from a design committed earlier
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const FIXTURE_BLOCK = 134_673_279n;

describe.skipIf(!TEST_DATABASE_URL)("circuits touched since a rebuild", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("nothing new since the rebuild's block: nothing touched", async () => {
		pool = await fixtureIndexedDatabase();
		expect(await circuitsTouchedSince(pool, FIXTURE_BLOCK)).toEqual([]);
	});

	test("a miner start touches the miner and every circuit sharing its netlist hash", async () => {
		pool = await fixtureIndexedDatabase();
		await pool.query(
			"update miners set last_started_block = $1 where processor = $2 and id = 2510",
			[(FIXTURE_BLOCK + 1n).toString(), MINE6],
		);
		const touched = await circuitsTouchedSince(pool, FIXTURE_BLOCK);
		expect(touched).toContainEqual({ processor: MINE6, id: 2510n });
		expect(touched).toContainEqual({ processor: MINE6, id: 2683n });
		const { rows } = await pool.query<{ n: number }>(
			`select count(*)::int as n from circuits where netlist_hash =
			   (select netlist_hash from circuits where processor = $1 and id = 2510)`,
			[MINE6],
		);
		expect(touched).toHaveLength(rows[0]?.n ?? 0);
	});

	test.each([
		[
			"a new tape-out",
			"update circuits set taped_out_block = $1 where processor = $2 and id = 2683",
		],
		[
			"a revoke",
			"update miners set revoked_block = $1, revoked_tx = 0, revoked_log = 0, revoked_vector = 0 where processor = $2 and id = 2683",
		],
		[
			"a netlist read",
			"update circuits set netlist_read_at_block = $1 where processor = $2 and id = 2683",
		],
		[
			"a design commitment read",
			"update miners set commitment_read_at_block = $1 where processor = $2 and id = 2683",
		],
	])("%s touches its circuit", async (_what, sql) => {
		pool = await fixtureIndexedDatabase();
		await pool.query(sql, [(FIXTURE_BLOCK + 1n).toString(), MINE6]);
		expect(await circuitsTouchedSince(pool, FIXTURE_BLOCK)).toContainEqual({
			processor: MINE6,
			id: 2683n,
		});
	});

	test("a new listing touches its circuit", async () => {
		pool = await fixtureIndexedDatabase();
		await pool.query(
			`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
			   price_wei, fee_bps, listed_block, listed_time)
			 values (1, $1, true, $2, $3, 2683, 1, 100, $1, 1)`,
			[(FIXTURE_BLOCK + 1n).toString(), `0x${"fd".repeat(20)}`, MINE6],
		);
		expect(await circuitsTouchedSince(pool, FIXTURE_BLOCK)).toContainEqual({
			processor: MINE6,
			id: 2683n,
		});
	});
});
