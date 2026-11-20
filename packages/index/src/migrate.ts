// Applies the numbered SQL files in migrations/ in order, each in its own transaction, and
// records which have run (docs/decisions/2026-11-20-database-access.md, decision 2). A file
// that has run is never edited; a change is a new file.

import { readdirSync, readFileSync } from "node:fs";
import type pg from "pg";

const DIR = new URL("../migrations/", import.meta.url);

/** Applies every migration not yet run. Returns the names it applied. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
	await pool.query(
		"create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())",
	);
	const done = new Set(
		(
			await pool.query<{ name: string }>("select name from migrations")
		).rows.map((r) => r.name),
	);
	const files = readdirSync(DIR)
		.filter((f) => /^\d{3}-[a-z0-9-]+\.sql$/.test(f))
		.sort();
	const applied: string[] = [];
	for (const name of files) {
		if (done.has(name)) continue;
		const client = await pool.connect();
		try {
			await client.query("begin");
			await client.query(readFileSync(new URL(name, DIR), "utf8"));
			await client.query("insert into migrations (name) values ($1)", [name]);
			await client.query("commit");
			applied.push(name);
		} catch (error) {
			await client.query("rollback");
			throw new Error(`migration ${name} failed: ${(error as Error).message}`);
		} finally {
			client.release();
		}
	}
	return applied;
}
