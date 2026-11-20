// Miners and their design commitments in the index (docs/decisions/2026-11-20-circuit-index.md,
// decision 4). A restart can bring a new commitment (verified PodMining source, `start`), so a
// new start clears the stored one and the commitment backfill reads it again.

import type { Hex32 } from "@foreman/contract";
import {
	type CircuitId,
	type MinerRevoke,
	type MinerRevokeScan,
	type MinerStartScan,
	readDesignCommitment,
} from "@foreman/originality";
import type pg from "pg";
import type { Address, PublicClient } from "viem";

export type CompleteMinerStartScan = Extract<
	MinerStartScan,
	{ complete: true }
>;

export type CompleteMinerRevokeScan = Extract<
	MinerRevokeScan,
	{ complete: true }
>;

export interface StoredMiner {
	key: Hex32;
	circuit: CircuitId;
	firstStartedBlock: bigint;
	lastStartedBlock: bigint;
	starts: number;
	commitment:
		| { status: "not-read" }
		/**
		 * committedAt null: started without a design commitment. Its time is null only for a
		 * commitment read before migration 004, until filled.
		 */
		| {
				status: "read";
				committedAt: { block: bigint; time: bigint | null } | null;
				readAtBlock: bigint;
		  };
	/** From its Revoked event; null when the revoke scan found none. */
	revoked: Omit<MinerRevoke, "key"> | null;
}

/**
 * Saves a revoke scan in one transaction. A revoke for a miner the index doesn't have means the
 * miner starts are behind or wrong: the whole scan is refused, never dropped in part.
 */
export async function saveMinerRevokes(
	pool: pg.Pool,
	scan: CompleteMinerRevokeScan,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const r of scan.revokes) {
			const updated = await client.query(
				`update miners set revoked_block = $2, revoked_tx = $3, revoked_log = $4, revoked_vector = $5
				 where key = $1`,
				[
					Buffer.from(r.key.slice(2), "hex"),
					r.revokedAt.block.toString(),
					r.revokedAt.txIndex,
					r.revokedAt.logIndex,
					r.vectorIndex,
				],
			);
			if (updated.rowCount !== 1) {
				throw new Error(
					`Revoked event for miner ${r.key} in block ${r.revokedAt.block}, which the index doesn't have`,
				);
			}
		}
		await client.query("update index_state set revokes_up_to_block = $1", [
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

export async function saveMinerStarts(
	pool: pg.Pool,
	scan: CompleteMinerStartScan,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const s of scan.starts) {
			await client.query(
				`insert into miners (key, processor, id, first_started_block, last_started_block,
				   last_started_tx, last_started_log, starts)
				 values ($1, $2, $3, $4, $4, $5, $6, 1)
				 on conflict (key) do update set
				   last_started_block = excluded.last_started_block,
				   last_started_tx = excluded.last_started_tx,
				   last_started_log = excluded.last_started_log,
				   starts = miners.starts + 1,
				   commitment_status = null, commitment_read_at_block = null, design_committed_at = null,
				   design_committed_time = null`,
				[
					Buffer.from(s.key.slice(2), "hex"),
					s.circuit.processor,
					s.circuit.id.toString(),
					s.startedAt.block.toString(),
					s.startedAt.txIndex,
					s.startedAt.logIndex,
				],
			);
		}
		const updated = await client.query(
			"update index_state set miners_up_to_block = $1",
			[scan.upToBlock.toString()],
		);
		if (updated.rowCount !== 1) {
			throw new Error(
				"the index is empty: save a tape-out scan before miner starts",
			);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

export async function readMiners(pool: pg.Pool): Promise<{
	upToBlock: bigint | null;
	/** null before the first revoke scan is saved. */
	revokesUpToBlock: bigint | null;
	miners: StoredMiner[];
}> {
	const state = await pool.query<{
		miners_up_to_block: string | null;
		revokes_up_to_block: string | null;
	}>("select miners_up_to_block, revokes_up_to_block from index_state");
	const rows = await pool.query<{
		key: Buffer;
		processor: string;
		id: string;
		first_started_block: string;
		last_started_block: string;
		starts: number;
		commitment_status: "read" | null;
		commitment_read_at_block: string | null;
		design_committed_at: string | null;
		design_committed_time: string | null;
		revoked_block: string | null;
		revoked_tx: number | null;
		revoked_log: number | null;
		revoked_vector: number | null;
	}>(
		`select key, processor, id, first_started_block, last_started_block, starts,
		   commitment_status, commitment_read_at_block, design_committed_at, design_committed_time,
		   revoked_block, revoked_tx, revoked_log, revoked_vector
		 from miners order by first_started_block, processor, id`,
	);
	const up = state.rows[0]?.miners_up_to_block;
	const revokesUp = state.rows[0]?.revokes_up_to_block;
	return {
		upToBlock: up == null ? null : BigInt(up),
		revokesUpToBlock: revokesUp == null ? null : BigInt(revokesUp),
		miners: rows.rows.map((r) => ({
			key: `0x${r.key.toString("hex")}` as Hex32,
			circuit: { processor: r.processor as Address, id: BigInt(r.id) },
			firstStartedBlock: BigInt(r.first_started_block),
			lastStartedBlock: BigInt(r.last_started_block),
			starts: r.starts,
			commitment:
				r.commitment_status === null
					? { status: "not-read" }
					: {
							status: "read",
							committedAt:
								r.design_committed_at === null
									? null
									: {
											block: BigInt(r.design_committed_at),
											time:
												r.design_committed_time === null
													? null
													: BigInt(r.design_committed_time),
										},
							readAtBlock: BigInt(r.commitment_read_at_block as string),
						},
			revoked:
				r.revoked_block === null
					? null
					: {
							vectorIndex: r.revoked_vector as number,
							revokedAt: {
								block: BigInt(r.revoked_block),
								txIndex: r.revoked_tx as number,
								logIndex: r.revoked_log as number,
							},
						},
		})),
	};
}

export interface CommitmentBackfillResult {
	/** The block every commitment was read at: the index's last block. */
	atBlock: bigint;
	read: number;
	/** Of those read, how many had a design commitment. */
	withCommitment: number;
	/** Reads that failed: nothing stored, tried again on the next run. Never "no commitment". */
	failed: { key: Hex32; detail: string }[];
	remaining: number;
}

/** Reads the design commitment of every miner not read yet (or started again since). */
export async function backfillCommitments(
	pool: pg.Pool,
	client: PublicClient,
	options: {
		concurrency?: number;
		onProgress?: (done: number, total: number) => void;
	} = {},
): Promise<CommitmentBackfillResult> {
	const state = await pool.query<{ up_to_block: string }>(
		"select up_to_block from index_state",
	);
	const row = state.rows[0];
	if (!row) throw new Error("the index is empty: save a tape-out scan first");
	const atBlock = BigInt(row.up_to_block);

	const unread = await pool.query<{ key: Buffer }>(
		"select key from miners where commitment_status is null order by first_started_block",
	);
	const keys = unread.rows.map((r) => `0x${r.key.toString("hex")}` as Hex32);
	const result: CommitmentBackfillResult = {
		atBlock,
		read: 0,
		withCommitment: 0,
		failed: [],
		remaining: 0,
	};
	const step = options.concurrency ?? 20;
	for (let i = 0; i < keys.length; i += step) {
		const batch = keys.slice(i, i + step);
		const reads = await Promise.all(
			batch.map((key) =>
				readDesignCommitment(client, key, { blockNumber: atBlock }),
			),
		);
		for (const [k, r] of reads.entries()) {
			const key = batch[k] as Hex32;
			if (!r.read) {
				result.failed.push({ key, detail: r.detail });
				continue;
			}
			await pool.query(
				`update miners set commitment_status = 'read', commitment_read_at_block = $2,
				   design_committed_at = $3, design_committed_time = $4
				 where key = $1 and commitment_status is null`,
				[
					Buffer.from(key.slice(2), "hex"),
					atBlock.toString(),
					r.committedAt?.block.toString() ?? null,
					r.committedAt?.time.toString() ?? null,
				],
			);
			result.read++;
			if (r.committedAt !== null) result.withCommitment++;
		}
		options.onProgress?.(Math.min(i + step, keys.length), keys.length);
	}
	const left = await pool.query<{ n: string }>(
		"select count(*) as n from miners where commitment_status is null",
	);
	result.remaining = Number(left.rows[0]?.n ?? 0);
	return result;
}
