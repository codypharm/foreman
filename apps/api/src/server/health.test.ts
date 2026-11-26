import {
	recordPublisherBalance,
	recordStage,
	type StageState,
} from "@foreman/index";
import { freshDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "./app.ts";
import { BEHIND_AFTER_SECONDS, healthOf, LOW_BALANCE_WEI } from "./health.ts";

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

// The publisher wallet's balance (docs/decisions/2026-11-23-low-balance-warning.md)
describe("healthOf with FabX's follow", () => {
	// 2026-11-26-fabx-follow.md, decision 4
	const others = [
		state("follow", { lastDone: done(4) }),
		state("refresh", { lastDone: done(4) }),
		state("publish", { lastDone: done(4) }),
	];
	const fabxStage = (s: StageState) => [others[0]!, s, ...others.slice(1)];

	test("FabX followed within 30 minutes is ok", () => {
		const h = healthOf(
			fabxStage(state("fabx", { lastDone: done(4) })),
			NOW,
			null,
			{ frozenAtBlock: null },
		);
		expect(h.status).toBe("ok");
		expect(h.stages[1]?.health).toBe("ok");
	});

	test("FabX not followed in 30 minutes, and not frozen, is behind: 503", () => {
		const h = healthOf(
			fabxStage(state("fabx", { lastDone: done(31), lastFailed: done(1) })),
			NOW,
			null,
			{ frozenAtBlock: null },
		);
		expect(h.status).toBe("behind");
		expect(h.stages[1]?.health).toBe("behind");
	});

	test("a frozen FabX is reported as frozen, never behind, however long ago it last followed", () => {
		const h = healthOf(
			fabxStage(state("fabx", { lastDone: done(600), lastSkipped: done(2) })),
			NOW,
			null,
			{ frozenAtBlock: 76_829_810n },
		);
		expect(h.status).toBe("ok");
		expect(h.stages[1]?.health).toBe("frozen");
	});

	test("without FabX's history stored, FabX isn't followed and isn't judged", () => {
		const h = healthOf(fabxStage(state("fabx")), NOW, null, null);
		expect(h.status).toBe("ok");
		expect(h.stages[1]?.health).toBe("not-following");
	});
});

describe("healthOf with the publisher's balance", () => {
	const fresh = [
		state("follow", { lastDone: done(3) }),
		state("refresh", { lastDone: done(3) }),
		state("publish", { lastDone: done(3) }),
	];
	const balance = (wei: bigint) => ({
		chainId: 1952,
		address: "0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
		wei,
		at: ago(3),
	});

	test("a balance under the threshold is low, and so is the whole", () => {
		const h = healthOf(fresh, NOW, balance(LOW_BALANCE_WEI - 1n));
		expect(h.status).toBe("low-balance");
		expect(h.stages[2]?.health).toBe("low-balance");
	});

	test("a balance at the threshold is ok", () => {
		const h = healthOf(fresh, NOW, balance(LOW_BALANCE_WEI));
		expect(h.status).toBe("ok");
		expect(h.stages[2]?.health).toBe("ok");
	});

	test("an empty wallet whose publish keeps failing shows as low balance at once, not after 30 minutes", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(3) }),
				state("refresh", { lastDone: done(3) }),
				state("publish", { lastDone: done(10), lastFailed: done(3) }),
			],
			NOW,
			balance(0n),
		);
		expect(h.status).toBe("low-balance");
	});

	test("a stage that is behind wins over a low balance", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(45) }),
				state("refresh", { lastDone: done(3) }),
				state("publish", { lastDone: done(3) }),
			],
			NOW,
			balance(0n),
		);
		expect(h.status).toBe("behind");
		expect(h.stages[2]?.health).toBe("low-balance");
	});

	test("while publishing is off the balance isn't judged", () => {
		const h = healthOf(
			[
				state("follow", { lastDone: done(3) }),
				state("refresh", { lastDone: done(3) }),
				state("publish", { lastDone: done(60), lastSkipped: done(3) }),
			],
			NOW,
			balance(0n),
		);
		expect(h.status).toBe("ok");
		expect(h.stages[2]?.health).toBe("not-publishing");
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

	test("answers 503, low balance, with the publisher's address and balance, when the wallet is nearly empty", async () => {
		pool = await freshDatabase();
		const at = BigInt(Math.floor(Date.now() / 1000)) - 60n;
		for (const stage of ["follow", "refresh", "publish"] as const) {
			await recordStage(pool, stage, { status: "done", summary: "done" }, at);
		}
		await recordPublisherBalance(pool, {
			chainId: 1952,
			address: "0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
			wei: 4n * 10n ** 16n,
			at,
		});
		const res = await app(pool).request("/health");
		expect(res.status).toBe(503);
		const body = (await res.json()) as {
			status: string;
			publisher: Record<string, unknown>;
			stages: Record<string, { health: string }>;
		};
		expect(body.status).toBe("low-balance");
		expect(body.stages.publish?.health).toBe("low-balance");
		expect(body.publisher).toMatchObject({
			chainId: 1952,
			address: "0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
			balanceOkb: "0.04",
			lowBelowOkb: "0.05",
			minutesAgo: 1,
		});
	});
});
