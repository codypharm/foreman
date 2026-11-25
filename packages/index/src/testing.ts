// Test helpers: a fresh, migrated test database.

import { podMiningAbi } from "@foreman/chain-bnb";
import { type Fixture, replayClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import type { MinerStart } from "@foreman/originality";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { fixtureIndex } from "@foreman/originality/testing";
import pg from "pg";
import {
	type Address,
	decodeFunctionResult,
	type Hex,
	zeroAddress,
} from "viem";
import { backfillNetlists } from "./backfill.ts";
import { migrate } from "./migrate.ts";
import { backfillCommitments, saveMinerStarts } from "./miners.ts";
import { type CompleteOwnerScan, isMint, saveOwnerScan } from "./owners.ts";
import { type CompleteScan, saveScan } from "./store.ts";

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
		upToBlock: index.upTo[0]!.block,
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

/**
 * The originality fixture's 33 circuits built into a test database the way the real index is:
 * tape-outs saved, netlists backfilled, its 16 miners saved (their Started events aren't in the
 * fixture, so each gets one made-up start) and their commitments backfilled.
 */
export async function fixtureIndexedDatabase(
	options: {
		netlistLimit?: number;
		skipCommitments?: boolean;
		skipMiners?: boolean;
		/** Save the miner starts as read up to this block instead of the index's. */
		minersUpTo?: bigint;
		/** The fixture with changed responses, e.g. from withNetlist. */
		changed?: Fixture;
	} = {},
): Promise<pg.Pool> {
	const pool = await freshDatabase();
	const client = replayClient(options.changed ?? circuits);
	await saveScan(pool, await fixtureCircuitsScan());
	await backfillNetlists(
		pool,
		client,
		options.netlistLimit === undefined ? {} : { limit: options.netlistLimit },
	);
	if (options.skipMiners) return pool;
	const starts: MinerStart[] = [];
	for (const c of circuits.calls) {
		const p = (c.params as { data?: string }[])[0];
		if (c.method !== "eth_call" || !p?.data?.startsWith("0x0527edc2")) continue;
		const m = decodeFunctionResult({
			abi: podMiningAbi,
			functionName: "getMiner",
			data: c.result as Hex,
		});
		if (m.circuits === zeroAddress) continue;
		starts.push({
			key: parseHex32(`0x${p.data.slice(10)}`, "key"),
			circuit: {
				processor: m.circuits.toLowerCase() as Address,
				id: m.circuitId,
			},
			startedAt: { block: 134_000_000n, txIndex: 0, logIndex: starts.length },
		});
	}
	await saveMinerStarts(pool, {
		complete: true,
		upToBlock: options.minersUpTo ?? BigInt(circuits.block),
		starts,
	});
	if (!options.skipCommitments) await backfillCommitments(pool, client);
	return pool;
}

/** The block the owners helper's made-up earlier scan starts at, and its tape-outs from. */
const OWNERS_SEED_BLOCK = 135_000_000n;

/**
 * An index ready for `scan`, a real owner scan: its mints become tape-outs at the same place (by
 * their receiver), and each circuit it moves without minting gets a made-up tape-out after
 * OWNERS_SEED_BLOCK by its first sender, with a made-up owner scan up to the block before `scan`
 * that mints it to that sender. Tape-outs are indexed up to the scan's last block. With
 * `onlyMints`, only the scan's mints are taped out and no owner scan is saved.
 */
export async function ownersIndexedDatabase(
	scan: CompleteOwnerScan,
	options: { onlyMints?: boolean } = {},
): Promise<pg.Pool> {
	const pool = await freshDatabase();
	const minted = new Set(
		scan.transfers
			.filter((t) => isMint(t))
			.map((t) => `${t.processor}/${t.id}`),
	);
	const earlier = new Map<string, CompleteOwnerScan["transfers"][number]>();
	for (const t of scan.transfers) {
		const k = `${t.processor}/${t.id}`;
		if (!minted.has(k) && !earlier.has(k)) earlier.set(k, t);
	}
	const seedMints = (options.onlyMints ? [] : [...earlier.values()]).map(
		(t, i) => ({
			processor: t.processor,
			id: t.id,
			from: zeroAddress as CompleteOwnerScan["transfers"][number]["from"],
			to: t.from,
			at: { block: OWNERS_SEED_BLOCK + BigInt(i), txIndex: 0, logIndex: 0 },
		}),
	);
	const mints = [...seedMints, ...scan.transfers.filter((t) => isMint(t))];
	const issued = new Map<Address, bigint>();
	for (const m of mints) {
		if ((issued.get(m.processor) ?? 0n) < m.id) issued.set(m.processor, m.id);
	}
	await saveScan(pool, {
		complete: true,
		upToBlock: scan.upToBlock,
		processors: [...issued].map(([address, n]) => ({ address, issued: n })),
		tapeOuts: mints.map((m) => ({
			circuit: { processor: m.processor, id: m.id },
			tapedOutAt: { ...m.at, time: 1_779_000_000n },
			tapedOutBy: m.to,
		})),
		dropped: [],
	});
	if (options.onlyMints) return pool;
	await saveOwnerScan(pool, {
		complete: true,
		fromBlock: OWNERS_SEED_BLOCK,
		upToBlock: scan.fromBlock - 1n,
		transfers: seedMints,
	});
	return pool;
}
