import { checkCopy, circuitRef } from "@foreman/originality";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { fixtureIndex, withNetlist } from "@foreman/originality/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { loadCircuitIndex, readCircuitRef } from "./index.ts";
import { fixtureIndexedDatabase, TEST_DATABASE_URL } from "./testing.ts";

// The originality fixture's 33 real circuits at block 134,673,279, built into the database the
// way the real index is. The copy check on the loaded index must give exactly what it gives on
// the fixture itself (packages/originality/src/check-copy.test.ts).
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const RULES = { sizeFloor: 0 };

describe.skipIf(!TEST_DATABASE_URL)(
	"loading the index for the copy check",
	() => {
		let pool: pg.Pool | undefined;
		afterEach(async () => {
			await pool?.end();
		});

		test("gives every circuit the same copy verdict as the fixture, commitments included", async () => {
			pool = await fixtureIndexedDatabase();
			const loaded = await loadCircuitIndex(pool);
			if (!loaded.ready) throw new Error(loaded.detail);
			expect(loaded.notCompared).toEqual({ unread: 0, unreadable: 0 });
			const expected = await fixtureIndex();
			expect(loaded.index.upToBlock).toBe(expected.upToBlock);
			for (const e of expected.entries) {
				expect(checkCopy(e.circuit, loaded.index, RULES)).toEqual(
					checkCopy(e.circuit, expected, RULES),
				);
			}
			// MINE6/2683 committed first, so the earlier tape-out MINE6/2510 is the copy
			expect(
				checkCopy({ processor: MINE6, id: 2510n }, loaded.index, RULES),
			).toMatchObject({
				kind: "copy",
				of: { circuit: { processor: MINE6, id: 2683n } },
				earlierBy: "commitment",
			});
		});

		test("leaves out circuits not read yet or unreadable, and counts only those compared", async () => {
			// One circuit left unread (the backfill stopped after 32), and MINE6/512 unreadable
			const changed = withNetlist(
				circuits,
				MINE6,
				512n,
				"0x01000003000000020000",
			);
			pool = await fixtureIndexedDatabase({ netlistLimit: 32, changed });
			const loaded = await loadCircuitIndex(pool);
			if (!loaded.ready) throw new Error(loaded.detail);
			expect(loaded.notCompared).toEqual({ unread: 1, unreadable: 1 });
			expect(loaded.index.entries).toHaveLength(31);
			expect(
				checkCopy({ processor: P0, id: 1n }, loaded.index, RULES),
			).toMatchObject({
				kind: "no-earlier-copy",
				circuitsChecked: 31,
			});
		});

		test("refuses while any miner's design commitment is unread, never treating it as none", async () => {
			pool = await fixtureIndexedDatabase({ skipCommitments: true });
			expect(await loadCircuitIndex(pool)).toEqual({
				ready: false,
				reason: "commitments-unread",
				detail: expect.stringContaining("16 miners"),
			});
		});

		test("refuses when miner starts are read to an earlier block than the tape-outs", async () => {
			pool = await fixtureIndexedDatabase({ minersUpTo: 134_600_000n });
			expect(await loadCircuitIndex(pool)).toEqual({
				ready: false,
				reason: "miners-behind",
				detail: expect.stringContaining("134600000"),
			});
		});

		test("refuses while a tape-out time is missing, never showing a blank date", async () => {
			pool = await fixtureIndexedDatabase();
			// A row saved before migration 004, not filled yet
			await pool.query(
				"update circuits set taped_out_time = null where processor = $1 and id = 1",
				[P0],
			);
			expect(await loadCircuitIndex(pool)).toEqual({
				ready: false,
				reason: "times-missing",
				detail: expect.stringContaining("1 circuit"),
			});
		});

		test("refuses while a design commitment's time is missing", async () => {
			pool = await fixtureIndexedDatabase();
			await pool.query(
				"update miners set design_committed_time = null where processor = $1 and id = 2683",
				[MINE6],
			);
			expect(await loadCircuitIndex(pool)).toEqual({
				ready: false,
				reason: "times-missing",
				detail: expect.stringContaining("1 design commitment"),
			});
		});

		test("gives any indexed circuit's CircuitRef, an unreadable one included, and null outside the index", async () => {
			const changed = withNetlist(
				circuits,
				MINE6,
				512n,
				"0x01000003000000020000",
			);
			pool = await fixtureIndexedDatabase({ changed });
			const expected = await fixtureIndex();
			for (const id of [2683n, 512n]) {
				const entry = expected.entries.find(
					(e) => e.circuit.processor === MINE6 && e.circuit.id === id,
				);
				if (!entry) throw new Error(`MINE6/${id} is in the fixture`);
				expect(await readCircuitRef(pool, { processor: MINE6, id })).toEqual(
					circuitRef(entry),
				);
			}
			expect(
				await readCircuitRef(pool, { processor: MINE6, id: 999_999n }),
			).toBeNull();
		});

		test("refuses a CircuitRef whose time isn't stored yet, never a blank date", async () => {
			pool = await fixtureIndexedDatabase();
			await pool.query(
				"update miners set design_committed_time = null where processor = $1 and id = 2683",
				[MINE6],
			);
			await expect(
				readCircuitRef(pool, { processor: MINE6, id: 2683n }),
			).rejects.toThrow("no stored time");
		});

		test("refuses before miners are indexed at all", async () => {
			pool = await fixtureIndexedDatabase({ skipMiners: true });
			expect(await loadCircuitIndex(pool)).toEqual({
				ready: false,
				reason: "miners-not-indexed",
				detail: expect.any(String),
			});
		});
	},
);
