import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	createApiKey,
	createWalletApiKey,
	findApiKey,
	readApiKeys,
	readWalletApiKey,
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
			wallet: null,
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

	test("a wallet has one live key: a new one revokes the old, and other wallets' keys are untouched", async () => {
		pool = await freshDatabase();
		const W = "0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5";
		const V = "0xc1c59c6ec5d37ef390282cbf2ae2908df3dbdf98";
		const at = (s: number) => new Date(Date.UTC(2026, 10, 27, 12, 0, s));
		const made = async (wallet: string, s: number) => {
			const r = await createWalletApiKey(pool as pg.Pool, wallet, at(s));
			if (!r.made) throw new Error("no key made");
			return r;
		};
		const first = await made(W, 0);
		const other = await made(V, 1);
		const second = await made(W, 2);
		expect(await findApiKey(pool, first.key)).toBeNull();
		expect(await findApiKey(pool, second.key)).toEqual({
			id: second.id,
			holder: W,
			wallet: W,
		});
		expect(await findApiKey(pool, other.key)).not.toBeNull();

		// A message no newer than the wallet's last one is refused: a signature can't be sent twice
		expect(await createWalletApiKey(pool, W, at(2))).toEqual({ made: false });
		expect(await createWalletApiKey(pool, W, at(1))).toEqual({ made: false });
		expect(await findApiKey(pool, second.key)).not.toBeNull();

		// The page asks whether a wallet has a live key, and when it was made; never the key
		const live = await readWalletApiKey(
			pool,
			W.toUpperCase().replace("0X", "0x"),
		);
		expect(live?.id).toBe(second.id);
		expect(live?.madeAt).toBeInstanceOf(Date);
		expect(Object.keys(live ?? {}).sort()).toEqual(["id", "madeAt"]);
		expect(
			await readWalletApiKey(
				pool,
				"0x0000000000000000000000000000000000000001",
			),
		).toBeNull();
		await revokeApiKey(pool, second.id);
		expect(await readWalletApiKey(pool, W)).toBeNull();

		const keys = await readApiKeys(pool);
		expect(keys.map((k) => [k.wallet, k.revoked])).toEqual([
			[W, true],
			[V, false],
			[W, true],
		]);
	});
});
