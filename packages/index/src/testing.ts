// Test helpers: a fresh, migrated test database.

import pg from "pg";
import { migrate } from "./migrate.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * A pool on an empty, migrated test database. It drops and recreates the schema, so it
 * refuses any database whose name doesn't end in _test.
 */
export async function freshDatabase(): Promise<pg.Pool> {
	if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
	const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
	if (!name.endsWith("_test")) {
		throw new Error(
			`refusing to wipe database "${name}": its name must end in _test`,
		);
	}
	const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
	await pool.query("drop schema public cascade; create schema public;");
	await migrate(pool);
	return pool;
}
