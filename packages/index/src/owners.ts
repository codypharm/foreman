// Each circuit's current holder on the two eligible processors, kept from their Transfer events
// (docs/decisions/2026-11-22-wallet-miners.md). A scan is saved whole or not at all: anything that
// says the read missed events, or that the index is behind, refuses it.

import {
	type CircuitTransferScan,
	PROCESSOR_MULTIPLIERS,
	scanCircuitTransfers,
} from "@foreman/chain-bnb";
import { type Hex32, parseHex32 } from "@foreman/contract";
import type pg from "pg";
import type { Address, PublicClient } from "viem";

export type CompleteOwnerScan = Extract<
	CircuitTransferScan,
	{ complete: true }
>;

const ZERO = "0x0000000000000000000000000000000000000000";
const ELIGIBLE = Object.keys(PROCESSOR_MULTIPLIERS);
/** A transfer from 0x0: the circuit's mint, at its tape-out. */
export const isMint = (t: { from: string }) => t.from === ZERO;

export interface StoredOwner {
	owner: Address;
	/** Where the circuit last changed hands (its mint, at tape-out, if never since). */
	since: { block: bigint; txIndex: number; logIndex: number };
}

export interface StoredOwners {
	/** null before the first owner scan is saved. */
	upToBlock: bigint | null;
	/** Keyed `${processor}/${id}`. */
	owners: Map<string, StoredOwner>;
}

/**
 * Saves an owner scan in one transaction. Refused whole when:
 * - it doesn't start right after the last saved scan, or (the first) starts after the eligible
 *   processors' first tape-out;
 * - it reaches past the tape-outs the index has;
 * - its mints aren't exactly the indexed tape-outs of the eligible processors in its range (a node
 *   without history returns an empty list instead of an error: CLAUDE.md, "RPC correction");
 * - a transfer's sender isn't the circuit's stored holder.
 * Saving the same scan twice is refused by the first rule.
 */
export async function saveOwnerScan(
	pool: pg.Pool,
	scan: CompleteOwnerScan,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const state = await client.query<{
			up_to_block: string;
			owners_up_to_block: string | null;
		}>("select up_to_block, owners_up_to_block from index_state for update");
		const row = state.rows[0];
		if (!row)
			throw new Error("owner scan refused: the index has no tape-outs saved");
		if (scan.upToBlock > BigInt(row.up_to_block)) {
			throw new Error(
				`owner scan refused: it reaches block ${scan.upToBlock}, past the tape-outs indexed up to ${row.up_to_block}`,
			);
		}
		if (row.owners_up_to_block === null) {
			const first = await client.query<{ first: string | null }>(
				"select min(taped_out_block) as first from circuits where processor = any($1)",
				[ELIGIBLE],
			);
			const firstTapeOut = first.rows[0]?.first;
			if (firstTapeOut != null && scan.fromBlock > BigInt(firstTapeOut)) {
				throw new Error(
					`owner scan refused: the first scan starts at block ${scan.fromBlock}, after the first tape-out at ${firstTapeOut}`,
				);
			}
		} else if (scan.fromBlock !== BigInt(row.owners_up_to_block) + 1n) {
			throw new Error(
				`owner scan refused: it starts at block ${scan.fromBlock}, but owners are saved up to ${row.owners_up_to_block}`,
			);
		}

		// The mints must be exactly the indexed tape-outs in the range, at the same block
		const tapeOuts = await client.query<{
			processor: string;
			id: string;
			block: string;
		}>(
			`select processor, id, taped_out_block as block from circuits
			 where processor = any($1) and taped_out_block between $2 and $3`,
			[ELIGIBLE, scan.fromBlock.toString(), scan.upToBlock.toString()],
		);
		const expected = new Set(
			tapeOuts.rows.map((t) => `${t.processor}/${t.id}@${t.block}`),
		);
		const minted = new Set(
			scan.transfers
				.filter((t) => isMint(t))
				.map((t) => `${t.processor}/${t.id}@${t.at.block}`),
		);
		const missing = [...expected].filter((m) => !minted.has(m));
		const extra = [...minted].filter((m) => !expected.has(m));
		if (missing.length > 0 || extra.length > 0) {
			throw new Error(
				`owner scan refused: its mints don't match the indexed tape-outs in blocks ${scan.fromBlock} to ${scan.upToBlock}` +
					(missing.length > 0
						? `; no mint for ${missing.slice(0, 5).join(", ")}`
						: "") +
					(extra.length > 0
						? `; mint with no tape-out for ${extra.slice(0, 5).join(", ")}`
						: ""),
			);
		}

		for (const t of scan.transfers) {
			const current = await client.query<{ owner: string }>(
				"select owner from circuit_owners where processor = $1 and id = $2",
				[t.processor, t.id.toString()],
			);
			const stored = current.rows[0];
			if (stored) {
				if (stored.owner !== t.from) {
					throw new Error(
						`owner scan refused: ${t.processor}/${t.id} moved from ${t.from} in block ${t.at.block}, but its stored holder is ${stored.owner}`,
					);
				}
			} else if (!isMint(t)) {
				throw new Error(
					`owner scan refused: ${t.processor}/${t.id} moved from ${t.from} in block ${t.at.block}, but it has no stored holder`,
				);
			}
			await client.query(
				`insert into circuit_owners (processor, id, owner, block, tx_index, log_index)
				 values ($1, $2, $3, $4, $5, $6)
				 on conflict (processor, id) do update set owner = excluded.owner, block = excluded.block,
				   tx_index = excluded.tx_index, log_index = excluded.log_index`,
				[
					t.processor,
					t.id.toString(),
					t.to,
					t.at.block.toString(),
					t.at.txIndex,
					t.at.logIndex,
				],
			);
		}
		await client.query("update index_state set owners_up_to_block = $1", [
			scan.upToBlock.toString(),
		]);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/** The stored holders: every circuit's, or only those one address holds. */
export async function readCircuitOwners(
	pool: pg.Pool,
	filter: { owner?: Address } = {},
): Promise<StoredOwners> {
	const state = await pool.query<{ owners_up_to_block: string | null }>(
		"select owners_up_to_block from index_state",
	);
	const rows = await pool.query<{
		processor: string;
		id: string;
		owner: string;
		block: string;
		tx_index: number;
		log_index: number;
	}>(
		`select processor, id, owner, block, tx_index, log_index from circuit_owners
		 where $1::text is null or owner = $1 order by block, tx_index, log_index`,
		[filter.owner?.toLowerCase() ?? null],
	);
	const upTo = state.rows[0]?.owners_up_to_block;
	return {
		upToBlock: upTo == null ? null : BigInt(upTo),
		owners: new Map(
			rows.rows.map((r) => [
				`${r.processor}/${BigInt(r.id)}`,
				{
					owner: r.owner as Address,
					since: {
						block: BigInt(r.block),
						txIndex: r.tx_index,
						logIndex: r.log_index,
					},
				},
			]),
		),
	};
}

/** Blocks scanned and saved at a time, so a long first fill keeps what it has read. */
const OWNER_SAVE_SPAN = 1_000_000n;

export type OwnerFollowResult =
	| { followed: true; toBlock: bigint; transfers: number }
	/** A read that failed, or a scan refused: what was saved before it stays. */
	| { followed: false; detail: string };

/**
 * Brings the owners from their last block up to `toBlock` (at most the tape-outs' block). The first
 * fill starts at the eligible processors' first tape-out, so it needs the archive node, and is
 * saved a million blocks at a time.
 */
export async function followOwners(
	pool: pg.Pool,
	client: PublicClient,
	options: { toBlock: bigint; onProgress?: (stage: string) => void },
): Promise<OwnerFollowResult> {
	const { toBlock, onProgress } = options;
	const state = await pool.query<{ owners_up_to_block: string | null }>(
		"select owners_up_to_block from index_state",
	);
	let from: bigint;
	const upTo = state.rows[0]?.owners_up_to_block;
	if (upTo != null) {
		from = BigInt(upTo) + 1n;
	} else {
		const first = await pool.query<{ first: string | null }>(
			"select min(taped_out_block) as first from circuits where processor = any($1)",
			[ELIGIBLE],
		);
		const firstTapeOut = first.rows[0]?.first;
		if (firstTapeOut == null) {
			return {
				followed: false,
				detail: "no tape-out of the eligible processors indexed yet",
			};
		}
		from = BigInt(firstTapeOut);
	}
	let transfers = 0;
	for (; from <= toBlock; from += OWNER_SAVE_SPAN) {
		const to =
			from + OWNER_SAVE_SPAN - 1n < toBlock
				? from + OWNER_SAVE_SPAN - 1n
				: toBlock;
		const scan = await scanCircuitTransfers(
			client,
			{ fromBlock: from, toBlock: to },
			onProgress,
		);
		if (!scan.complete) return { followed: false, detail: scan.detail };
		try {
			await saveOwnerScan(pool, scan);
		} catch (error) {
			return { followed: false, detail: (error as Error).message };
		}
		transfers += scan.transfers.length;
	}
	return { followed: true, toBlock, transfers };
}

/** A started miner (in any state now) as the index has it. */
export interface IndexedMiner {
	circuit: { processor: Address; id: bigint };
	key: Hex32;
	/** null when its netlist hasn't been read or couldn't be. */
	gateCount: number | null;
}

/**
 * The started miners, in any state now, whose NFT `owner` holds at the owner follow's block
 * (docs/decisions/2026-11-22-wallet-miners.md), with the block it last moved to them.
 */
export async function readHeldMiners(
	pool: pg.Pool,
	owner: Address,
): Promise<{
	/** null before the first owner scan is saved. */
	upToBlock: bigint | null;
	miners: (IndexedMiner & { ownerSince: bigint })[];
}> {
	const state = await pool.query<{ owners_up_to_block: string | null }>(
		"select owners_up_to_block from index_state",
	);
	const rows = await pool.query<MinerRow & { block: string }>(
		`select o.processor, o.id::text, o.block::text, m.key, c.gate_count
		 from circuit_owners o
		 join miners m on m.processor = o.processor and m.id = o.id
		 join circuits c on c.processor = o.processor and c.id = o.id
		 where o.owner = $1 order by o.processor, o.id`,
		[owner.toLowerCase()],
	);
	const upTo = state.rows[0]?.owners_up_to_block;
	return {
		upToBlock: upTo == null ? null : BigInt(upTo),
		miners: rows.rows.map((r) => ({
			...indexedMiner(r),
			ownerSince: BigInt(r.block),
		})),
	};
}

/** The started miner on this circuit, or null when the index has none (never started, or behind). */
export async function readIndexedMiner(
	pool: pg.Pool,
	circuit: { processor: Address; id: bigint },
): Promise<IndexedMiner | null> {
	const rows = await pool.query<MinerRow>(
		`select m.processor, m.id::text, m.key, c.gate_count
		 from miners m join circuits c on c.processor = m.processor and c.id = m.id
		 where m.processor = $1 and m.id = $2`,
		[circuit.processor.toLowerCase(), circuit.id.toString()],
	);
	const r = rows.rows[0];
	return r ? indexedMiner(r) : null;
}

interface MinerRow {
	processor: string;
	id: string;
	key: Buffer;
	gate_count: number | null;
}

function indexedMiner(r: MinerRow): IndexedMiner {
	return {
		circuit: { processor: r.processor as Address, id: BigInt(r.id) },
		key: parseHex32(`0x${r.key.toString("hex")}`, "miners.key"),
		gateCount: r.gate_count,
	};
}
