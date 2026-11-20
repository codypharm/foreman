import { replayClient } from "@foreman/chain-bnb/fixture";
import fixture from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { withNetlist } from "@foreman/originality/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { backfillNetlists, readStoredNetlist, saveScan } from "./index.ts";
import {
	fixtureCircuitsScan,
	freshDatabase,
	TEST_DATABASE_URL,
} from "./testing.ts";

// The originality fixture: 33 real circuits at BNB block 134,673,279
// (packages/originality/fixtures/README.md). Expected values were decoded by a separate decoder.
// Rules: docs/decisions/2026-11-20-circuit-index.md, decision 4.
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

describe.skipIf(!TEST_DATABASE_URL)("the netlist backfill", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	async function indexed() {
		pool = await freshDatabase();
		await saveScan(pool, await fixtureCircuitsScan());
		return pool;
	}

	test("stores every circuit's netlist, counts and both hashes, read at the index block", async () => {
		const db = await indexed();
		const result = await backfillNetlists(db, replayClient(fixture));
		expect(result).toMatchObject({
			read: 33,
			unreadable: 0,
			failed: [],
			remaining: 0,
		});

		// One LATCH and one NAND of a signal with itself: sorting changes nothing
		const stored = await readStoredNetlist(db, { processor: MINE6, id: 512n });
		expect(stored).toEqual({
			status: "read",
			readAtBlock: 134_673_279n,
			nIn: 0,
			nOut: 1,
			nState: 1,
			gateCount: 2,
			bytes: "0x0100000300000002000002",
			netlistHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
			byteHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
			hashRule: "2026-11-20",
		});
		if (stored?.status !== "read") return;
		expect(stored.netlistHash).toBe(stored.byteHash);

		// MINE6/1510 and /1570 differ only by swapped NAND inputs
		const a = await readStoredNetlist(db, { processor: MINE6, id: 1510n });
		const b = await readStoredNetlist(db, { processor: MINE6, id: 1570n });
		if (a?.status !== "read" || b?.status !== "read")
			throw new Error("not read");
		expect(a.netlistHash).toBe(b.netlistHash);
		expect(a.byteHash).not.toBe(b.byteHash);
	});

	test("stores a netlist that doesn't decode as unreadable, so it shows as can't check", async () => {
		const db = await indexed();
		// MINE6/512's saved bytes with the NAND cut off mid-record: the chain never returns this
		const f = withNetlist(fixture, MINE6, 512n, "0x01000003000000020000");
		const result = await backfillNetlists(db, replayClient(f));
		expect(result).toMatchObject({
			read: 32,
			unreadable: 1,
			failed: [],
			remaining: 0,
		});
		expect(await readStoredNetlist(db, { processor: MINE6, id: 512n })).toEqual(
			{
				status: "unreadable",
				readAtBlock: 134_673_279n,
				detail: expect.stringContaining(`${MINE6}/512`),
			},
		);
	});

	test("leaves a circuit whose read failed unread, and the next run reads it", async () => {
		const db = await indexed();
		// The node doesn't answer MINE6/512's netlist call
		const data = `0x3fc4be56${(512).toString(16).padStart(64, "0")}`;
		const broken = {
			...fixture,
			calls: fixture.calls.filter(
				(c) => (c.params as { data?: string }[])[0]?.data !== data,
			),
		};
		const first = await backfillNetlists(db, replayClient(broken));
		expect(first).toMatchObject({ read: 32, unreadable: 0, remaining: 1 });
		expect(first.failed).toEqual([
			{ circuit: { processor: MINE6, id: 512n }, detail: expect.any(String) },
		]);
		expect(await readStoredNetlist(db, { processor: MINE6, id: 512n })).toEqual(
			{
				status: "not-read",
			},
		);

		const second = await backfillNetlists(db, replayClient(fixture));
		expect(second).toMatchObject({ read: 1, failed: [], remaining: 0 });
	});

	test("a backfill stopped part-way resumes where it left off", async () => {
		const db = await indexed();
		const first = await backfillNetlists(db, replayClient(fixture), {
			limit: 10,
		});
		expect(first).toMatchObject({ read: 10, remaining: 23 });
		const second = await backfillNetlists(db, replayClient(fixture));
		expect(second).toMatchObject({ read: 23, remaining: 0 });
	});
});
