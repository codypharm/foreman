// One transaction for several saves: a function given the pool opens its own; given a client
// already in a transaction, it runs inside the caller's, so a caller can save several things all
// or nothing (2026-11-26-fabx-follow.md, decision 5).

import type pg from "pg";

/** The pool, or a client inside a caller's transaction. */
export type Db = pg.Pool | pg.PoolClient;

export async function inTransaction<T>(
	db: Db,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
	if ("release" in db) return fn(db);
	const client = await db.connect();
	try {
		await client.query("begin");
		const result = await fn(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}
