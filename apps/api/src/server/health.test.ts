import { recordStage, type StageState } from "@foreman/index";
import { freshDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "./app.ts";
import { BEHIND_AFTER_SECONDS, healthOf } from "./health.ts";

// Whether the hosted worker is keeping up (docs/decisions/2026-11-23-hosting.md, decision 7).

const NOW = 1_800_000_000n;
const ago = (minutes: number) => NOW - BigInt(minutes * 60);

function state(
	stage: StageState["stage"],
	parts: Partial<Omit<StageState, "stage">> = {},
): StageState {
	return {
		stage,
		lastDone: null,
		lastSkipped: null,
		lastFailed: null,
		...parts,
	};
}
const done = (minutes: number) => ({ at: ago(minutes), text: "done" });

describe("healthOf", () => {
	test("every stage finished within 30 minutes is ok", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(4) }),
				state("refresh", { lastDone: done(4) }),
				state("publish", { lastDone: done(4) }),
			],
			NOW,
		);
		expect(h.status).toBe("ok");
		expect(h.stages.map((s) => s.health)).toEqual(["ok", "ok", "ok"]);
	});

	test("a stage whose last finish is over 30 minutes old is behind, and so is the whole", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(31), lastFailed: done(2) }),
				state("refresh", { lastDone: done(4) }),
				state("publish", { lastDone: done(4) }),
			],
			NOW,
		);
		expect(h.status).toBe("behind");
		expect(h.stages[0]?.health).toBe("behind");
	});

	test("exactly 30 minutes is still ok", () => {
		const h = healthOf(
			[
				state("follow", {
					lastDone: { at: NOW - BEHIND_AFTER_SECONDS, text: "done" },
				}),
				state("refresh", { lastDone: done(1) }),
				state("publish", { lastDone: done(1) }),
			],
			NOW,
		);
		expect(h.status).toBe("ok");
	});

	test("a worker that never ran is behind, never ok", () => {
		const h = healthOf(
			[state("follow"), state("refresh"), state("publish")],
			NOW,
		);
		expect(h.status).toBe("behind");
		expect(h.stages.map((s) => s.health)).toEqual([
			"behind",
			"behind",
			"behind",
		]);
	});

	test("a publish skipped for want of a key is not publishing, which isn't behind", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(3) }),
				state("refresh", { lastDone: done(3) }),
				state("publish", { lastSkipped: done(3) }),
			],
			NOW,
		);
		expect(h.status).toBe("ok");
		expect(h.stages[2]?.health).toBe("not-publishing");
	});

	test("a publish that failed after its last skip is judged by its last finish", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(3) }),
				state("refresh", { lastDone: done(3) }),
				state("publish", { lastSkipped: done(60), lastFailed: done(3) }),
			],
			NOW,
		);
		expect(h.stages[2]?.health).toBe("behind");
	});
});

describe.skipIf(!TEST_DATABASE_URL)("GET /health", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	const app = (p: pg.Pool) =>
		createApp({ pool: p } as unknown as Parameters<typeof createApp>[0]);

	test("answers 503, behind, before the worker has run", async () => {
		pool = await freshDatabase();
		const res = await app(pool).request("/health");
		expect(res.status).toBe(503);
		const body = (await res.json()) as {
			status: string;
			stages: Record<string, { health: string; lastDone: unknown }>;
		};
		expect(body.status).toBe("behind");
		expect(body.stages.follow).toEqual({
			health: "behind",
			lastDone: null,
			lastSkipped: null,
			lastFailed: null,
		});
	});

	test("answers 200 after a fresh run, with each stage's line and how long ago", async () => {
		pool = await freshDatabase();
		const at = BigInt(Math.floor(Date.now() / 1000)) - 120n;
		await recordStage(
			pool,
			"follow",
			{ status: "done", summary: "to BNB block 135256173" },
			at,
		);
		await recordStage(
			pool,
			"refresh",
			{ status: "done", summary: "changes rebuild" },
			at,
		);
		await recordStage(
			pool,
			"publish",
			{ status: "skipped", summary: "no PUBLISHER_KEY set" },
			at,
		);
		const res = await app(pool).request("/health");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			behindAfterMinutes: number;
			stages: Record<
				string,
				{
					health: string;
					lastDone: { minutesAgo: number; text: string } | null;
				}
			>;
		};
		expect(body.status).toBe("ok");
		expect(body.behindAfterMinutes).toBe(30);
		expect(body.stages.follow?.lastDone).toMatchObject({
			minutesAgo: 2,
			text: "to BNB block 135256173",
		});
		expect(body.stages.publish?.health).toBe("not-publishing");
	});
});
