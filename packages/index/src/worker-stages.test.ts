import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { readStages, recordStage } from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// The worker's last outcome per stage (docs/decisions/2026-11-23-hosting.md, decision 7).

describe.skipIf(!TEST_DATABASE_URL)("worker stages", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("a stage that never ran reads as empty, never as done", async () => {
		pool = await freshDatabase();
		expect(await readStages(pool)).toEqual([
			{ stage: "follow", lastDone: null, lastSkipped: null, lastFailed: null },
			{ stage: "refresh", lastDone: null, lastSkipped: null, lastFailed: null },
			{ stage: "publish", lastDone: null, lastSkipped: null, lastFailed: null },
		]);
	});

	test("a failure keeps the last success beside it", async () => {
		pool = await freshDatabase();
		await recordStage(
			pool,
			"follow",
			{ status: "done", summary: "to BNB block 100" },
			1_000n,
		);
		await recordStage(
			pool,
			"follow",
			{ status: "failed", detail: "node down" },
			1_300n,
		);
		const [follow] = await readStages(pool);
		expect(follow).toEqual({
			stage: "follow",
			lastDone: { at: 1_000n, text: "to BNB block 100" },
			lastSkipped: null,
			lastFailed: { at: 1_300n, text: "node down" },
		});
	});

	test("a later success replaces the earlier one", async () => {
		pool = await freshDatabase();
		await recordStage(
			pool,
			"publish",
			{ status: "skipped", summary: "no key" },
			1_000n,
		);
		await recordStage(
			pool,
			"publish",
			{ status: "done", summary: "3 results" },
			1_300n,
		);
		await recordStage(
			pool,
			"publish",
			{ status: "done", summary: "nothing changed" },
			1_600n,
		);
		const publish = (await readStages(pool))[2];
		expect(publish?.lastDone).toEqual({ at: 1_600n, text: "nothing changed" });
		expect(publish?.lastSkipped).toEqual({ at: 1_000n, text: "no key" });
	});
});
