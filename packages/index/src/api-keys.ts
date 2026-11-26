// API keys for markets and lenders (docs/decisions/2026-11-26-api-keys.md, decisions 5 and 6). A key
// is random, shown once by createApiKey and never stored: only its SHA-256 hash is. Keys are random
// enough that a plain hash can't be reversed, so no slow hash is needed.

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export interface ApiKeyHolder {
	id: number;
	holder: string;
}

export interface ApiKeyRecord extends ApiKeyHolder {
	createdAt: Date;
	revoked: boolean;
	/** Calls and circuits per UTC day, oldest first. */
	days: { day: string; calls: number; circuits: number }[];
}

const hash = (key: string) => createHash("sha256").update(key).digest();

/** Makes a key for `holder`. The returned key is the only copy: it can't be read back. */
export async function createApiKey(
	pool: pg.Pool,
	holder: string,
): Promise<{ id: number; key: string }> {
	const key = `fmn_${randomBytes(24).toString("base64url")}`;
	const { rows } = await pool.query<{ id: number }>(
		"insert into api_keys (holder, key_hash) values ($1, $2) returning id",
		[holder, hash(key)],
	);
	const id = rows[0]?.id;
	if (id === undefined) throw new Error("the new API key wasn't saved");
	return { id, key };
}

/** The holder of a key that exists and isn't revoked; null for any other. */
export async function findApiKey(
	pool: pg.Pool,
	key: string,
): Promise<ApiKeyHolder | null> {
	if (!key.startsWith("fmn_")) return null;
	const { rows } = await pool.query<ApiKeyHolder>(
		"select id, holder from api_keys where key_hash = $1 and revoked_at is null",
		[hash(key)],
	);
	return rows[0] ?? null;
}

/** Revokes a key; false when there's no such key or it was already revoked. */
export async function revokeApiKey(
	pool: pg.Pool,
	id: number,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"update api_keys set revoked_at = now() where id = $1 and revoked_at is null",
		[id],
	);
	return rowCount === 1;
}

/** Adds one call of `circuits` circuits to the key's count for `day` (YYYY-MM-DD, UTC). */
export async function recordApiUsage(
	pool: pg.Pool,
	keyId: number,
	circuits: number,
	day: string,
): Promise<void> {
	await pool.query(
		`insert into api_usage (key_id, day, calls, circuits) values ($1, $2, 1, $3)
		 on conflict (key_id, day) do update
		 set calls = api_usage.calls + 1, circuits = api_usage.circuits + excluded.circuits`,
		[keyId, day, circuits],
	);
}

/** Every key, oldest first, with its daily counts. */
export async function readApiKeys(pool: pg.Pool): Promise<ApiKeyRecord[]> {
	const keys = await pool.query<{
		id: number;
		holder: string;
		created_at: Date;
		revoked: boolean;
	}>(
		"select id, holder, created_at, revoked_at is not null as revoked from api_keys order by id",
	);
	const usage = await pool.query<{
		key_id: number;
		day: string;
		calls: string;
		circuits: string;
	}>(
		"select key_id, day::text, calls::text, circuits::text from api_usage order by key_id, day",
	);
	return keys.rows.map((k) => ({
		id: k.id,
		holder: k.holder,
		createdAt: k.created_at,
		revoked: k.revoked,
		days: usage.rows
			.filter((u) => u.key_id === k.id)
			.map((u) => ({
				day: u.day,
				calls: Number(u.calls),
				circuits: Number(u.circuits),
			})),
	}));
}
