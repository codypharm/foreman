// Test helpers: a fresh, migrated test database.

import { minerKey, podMiningAbi } from "@foreman/chain-bnb";
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
	keccak256,
	toHex,
	zeroAddress,
} from "viem";
import fabxNetlists from "../fixtures/fabx-netlists-76847895.json" with {
	type: "json",
};
import { backfillNetlists } from "./backfill.ts";
import {
	backfillFabxNetlists,
	saveFabxHistory,
	saveFabxMiners,
} from "./fabx.ts";
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

/** FabX's processor and the X Layer block its test history is stored up to. */
const FABX_P = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
const FABX_BLOCK = 76_847_895n;

/**
 * The fixture's BNB Chain index with five real FabX circuits beside it, at X Layer block
 * 76,847,895 (fixtures/fabx-netlists-76847895.json): #24, a miner; #66, a stopped miner with the
 * same netlist, taped out after it; #4206, a miner; #6147, a wrapper of #4206 that isn't a
 * miner; and #1961, a miner. Tape-outs, statuses and stop block are real; design commitments are
 * left out, so every commitment is "none".
 */
export async function fabxIndexedDatabase(): Promise<pg.Pool> {
	const pool = await fixtureIndexedDatabase();
	const tapeOut = (
		id: bigint,
		block: bigint,
		tx: number,
		log: number,
		time: bigint,
		by: Address,
	) => ({
		processor: FABX_P,
		id,
		at: { block, tx, log },
		time,
		tapedOutBy: by,
	});
	await saveFabxHistory(
		pool,
		{
			fromBlock: 73_042_958n,
			toBlock: FABX_BLOCK,
			history: {
				ok: true,
				tapeOuts: [
					tapeOut(
						24n,
						73_044_971n,
						22,
						91,
						1_791_814_007n,
						"0xd2c3fadcdf186e82cf30d273154e7d7bb679bbee",
					),
					tapeOut(
						66n,
						73_045_389n,
						23,
						88,
						1_791_814_425n,
						"0x733b1e13dff45b2dbf472e12edc0917020448e49",
					),
					tapeOut(
						1961n,
						73_131_781n,
						3,
						5,
						1_791_900_817n,
						"0xf264c21243a974408d0564e50c54425904cd252e",
					),
					tapeOut(
						4206n,
						73_361_104n,
						10,
						38,
						1_792_130_140n,
						"0xf3f1c49df387bc9d23c8eeb1ef8bf67b033f0221",
					),
					tapeOut(
						6147n,
						73_831_216n,
						4,
						9,
						1_792_600_252n,
						"0x0b023ab5a493a3f282dc0659ef634710f05579b5",
					),
				],
				commitments: [],
				starts: [],
				contractEvents: [],
				otherLogs: 0,
			},
		},
		{
			implementation: "0x90681776c2d6be4676d83fa8fef22836b5dbbeeb",
			atBlock: 73_517_253n,
		},
	);
	const miner = (
		id: bigint,
		status: 1 | 3,
		stopBlock: bigint | null,
		taskId: number,
	) => ({
		processor: FABX_P,
		id,
		key: minerKey({ processor: FABX_P, id }),
		status,
		stopBlock,
		registrant: "0x239611ea0488b8a4bfe3b7dcd205baebd6c3a99f" as Address,
		taskId,
		commitBlock: 0n,
		firstUnusedId: 0n,
	});
	await saveFabxMiners(pool, {
		complete: true,
		block: FABX_BLOCK,
		miners: [
			miner(24n, 1, null, 0),
			miner(66n, 3, 74_423_691n, 0),
			miner(1961n, 1, null, 48),
			miner(4206n, 1, null, 70),
		],
		notMiners: 1,
	});
	await backfillFabxNetlists(pool, replayClient(fabxNetlists));
	return pool;
}

/** The block fabxFollowDatabase stores FabX's history up to, and where its follow test ends. */
export const FABX_FOLLOW_FROM = 76_829_600n;
export const FABX_FOLLOW_TO = 76_829_899n;

/**
 * FabX's history stored up to X Layer block 76,829,600 with two real circuits, #24 and #7160, and
 * no miners yet: the start of the follow test, which reads on to block 76,829,899 and finds the
 * real tape-outs #7161 to #7164 (fixtures/fabx-follow-76829899.json).
 */
export async function fabxFollowDatabase(): Promise<pg.Pool> {
	const pool = await freshDatabase();
	const tapeOut = (
		id: bigint,
		block: bigint,
		tx: number,
		log: number,
		time: bigint,
		by: Address,
	) => ({
		processor: FABX_P,
		id,
		at: { block, tx, log },
		time,
		tapedOutBy: by,
	});
	await saveFabxHistory(
		pool,
		{
			fromBlock: 73_042_958n,
			toBlock: FABX_FOLLOW_FROM,
			history: {
				ok: true,
				tapeOuts: [
					tapeOut(
						24n,
						73_044_971n,
						22,
						91,
						1_791_814_007n,
						"0xd2c3fadcdf186e82cf30d273154e7d7bb679bbee",
					),
					tapeOut(
						7160n,
						76_690_027n,
						8,
						10,
						1_795_459_063n,
						"0xa1ce751322fdec6365a9b5783c5291c8d889b844",
					),
				],
				commitments: [],
				starts: [],
				contractEvents: [],
				otherLogs: 0,
			},
		},
		{
			implementation: "0x90681776c2d6be4676d83fa8fef22836b5dbbeeb",
			atBlock: 73_517_253n,
		},
	);
	return pool;
}

/** A node's raw log, as eth_getLogs returns it. */
export interface RawLog {
	address: Address;
	topics: Hex[];
	data: Hex;
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
	transactionHash: Hex;
	blockTimestamp: Hex;
}

/** A node that answers as `node` does, with `extra` logs added to each log read whose range holds them. */
export function withExtraLogs<
	N extends {
		request(args: { method: string; params?: unknown }): Promise<unknown>;
	},
>(node: N, extra: RawLog[]): N {
	return {
		...node,
		request: async (args: { method: string; params?: unknown }) => {
			const result = await node.request(args);
			if (args.method !== "eth_getLogs") return result;
			const [q] = args.params as [{ fromBlock: Hex; toBlock: Hex }];
			const added = extra.filter(
				(l) =>
					BigInt(l.blockNumber) >= BigInt(q.fromBlock) &&
					BigInt(l.blockNumber) <= BigInt(q.toBlock),
			);
			return [...(result as RawLog[]), ...added];
		},
	};
}

/**
 * Made up: a freezing event on FabX's mining contract at X Layer block 76,829,810, between the
 * real tape-outs #7162 (block 76,829,798) and #7163 (block 76,829,819).
 */
export function fakeFabxChange(kind: "Upgraded" | "Paused"): RawLog {
	const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}` as Hex;
	const base = {
		address: "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265" as Address,
		blockNumber: toHex(76_829_810n),
		transactionIndex: "0x0" as Hex,
		logIndex: "0x0" as Hex,
		transactionHash: pad("0xfa4e") as Hex,
		blockTimestamp: toHex(1_795_598_846n),
	};
	return kind === "Upgraded"
		? {
				...base,
				topics: [
					keccak256(toHex("Upgraded(address)")),
					pad("0x000000000000000000000000000000000000dead"),
				],
				data: "0x",
			}
		: {
				...base,
				topics: [keccak256(toHex("Paused(address)"))],
				data: pad("0xfb7708019e64462126bafffc30c03e770e455ef8"),
			};
}
