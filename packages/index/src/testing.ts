// Test helpers: a fresh, migrated test database.

import { fixtureIndex } from "@foreman/originality/testing";
import pg from "pg";
import type { Address } from "viem";
import { migrate } from "./migrate.ts";
import type { CompleteScan } from "./store.ts";

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

/**
 * The originality fixture's 33 circuits (packages/originality/fixtures/README.md) as a saved
 * scan up to block 134,673,279, so the netlist backfill can read them from the same fixture.
 * Each processor's issued count is its highest fixture id: made up, but only the tape-outs
 * matter to the backfill.
 */
export async function fixtureCircuitsScan(): Promise<CompleteScan> {
	const index = await fixtureIndex();
	const issued = new Map<Address, bigint>();
	for (const e of index.entries) {
		const p = e.circuit.processor;
		if ((issued.get(p) ?? 0n) < e.circuit.id) issued.set(p, e.circuit.id);
	}
	return {
		complete: true,
		upToBlock: index.upToBlock,
		processors: [...issued].map(([address, n]) => ({ address, issued: n })),
		tapeOuts: index.entries
			.map((e) => ({
				circuit: e.circuit,
				tapedOutAt: e.tapedOutAt,
				tapedOutBy: e.tapedOutBy,
			}))
			.sort((a, b) =>
				a.tapedOutAt.block !== b.tapedOutAt.block
					? a.tapedOutAt.block < b.tapedOutAt.block
						? -1
						: 1
					: a.tapedOutAt.txIndex - b.tapedOutAt.txIndex ||
						a.tapedOutAt.logIndex - b.tapedOutAt.logIndex,
			),
		dropped: [],
	};
}

/** An index whose tape-out scan is saved up to `block`, with no tape-outs: enough for miner tests. */
export async function emptyIndexAt(block: bigint): Promise<pg.Pool> {
	const pool = await freshDatabase();
	await pool.query("insert into index_state (up_to_block) values ($1)", [
		block.toString(),
	]);
	return pool;
}
