import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	createApiKey,
	findApiKey,
	readApiKeys,
	recordApiUsage,
	revokeApiKey,
} from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// API keys for markets and lenders (docs/decisions/2026-11-26-api-keys.md, decisions 5 and 6): a key
// is shown once and only its hash is kept; a revoked key is refused; each call adds to its day's count.

describe.skipIf(!TEST_DATABASE_URL)("API keys", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("a new key is found by its holder until it is revoked; an unknown key never is", async () => {
		pool = await freshDatabase();
		const made = await createApiKey(pool, "OwlGate");
		expect(made.key).toMatch(/^fmn_[A-Za-z0-9_-]{32}$/);
		expect(await findApiKey(pool, made.key)).toEqual({
			id: made.id,
			holder: "OwlGate",
		});
		expect(await findApiKey(pool, `${made.key}x`)).toBeNull();
		expect(await findApiKey(pool, "")).toBeNull();

		// Only the hash is stored: the key itself is nowhere in the table
		const { rows } = await pool.query("select * from api_keys");
		expect(JSON.stringify(rows)).not.toContain(made.key.slice(4));

		expect(await revokeApiKey(pool, made.id)).toBe(true);
		expect(await findApiKey(pool, made.key)).toBeNull();
		expect(await revokeApiKey(pool, made.id)).toBe(false);
	});

	test("each call adds to the key's count for its day", async () => {
		pool = await freshDatabase();
		const a = await createApiKey(pool, "OwlGate");
		const b = await createApiKey(pool, "TapePool");
		await recordApiUsage(pool, a.id, 100, "2026-11-27");
		await recordApiUsage(pool, a.id, 3, "2026-11-27");
		await recordApiUsage(pool, a.id, 1, "2026-11-28");
		const keys = await readApiKeys(pool);
		expect(keys.map((k) => [k.holder, k.revoked, k.days])).toEqual([
			[
				"OwlGate",
				false,
				[
					{ day: "2026-11-27", calls: 2, circuits: 103 },
					{ day: "2026-11-28", calls: 1, circuits: 1 },
				],
			],
			["TapePool", false, []],
		]);
		expect(keys[1]?.id).toBe(b.id);
	});
});
