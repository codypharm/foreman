// FabX's history in its own tables (docs/decisions/2026-11-25-fabx-storage.md, migration 015):
// tape-outs, design commitments, starts and contract changes, decoded from FabX's logs, and how
// far they are read. A contract change after the reviewed block freezes FabX results
// (2026-11-25-fabx-copy-check.md, decision 6); only William moves the reviewed block.

import {
	FABX_FIRST_BLOCK,
	type FabxContractEventKind,
	type FabxHistory,
	type FabxMinersRead,
} from "@foreman/chain-xlayer";
import { type CommitmentEvent, confirmCommitment } from "@foreman/originality";
import type pg from "pg";
import type { Address, PublicClient } from "viem";
import {
	type BackfillOptions,
	type BackfillResult,
	backfillTable,
} from "./backfill.ts";

/** Contract changes that freeze FabX results when after the reviewed block (decision 6). */
export const FREEZING: readonly FabxContractEventKind[] = [
	"Upgraded",
	"OwnershipTransferred",
	"ProcessorSet",
];

export interface Reviewed {
	implementation: string;
	atBlock: bigint;
}

export interface FabxState {
	logsUpToBlock: bigint;
	reviewed: Reviewed;
	/** The block of the first freezing change after the reviewed block, or null. */
	frozenAtBlock: bigint | null;
}

/**
 * Saves one decoded range of FabX's logs. Ranges must follow on: one that starts after the
 * stored block + 1 would leave a gap and is refused. Saving a range again changes nothing.
 * `reviewed` is stored with the first range only.
 */
export async function saveFabxHistory(
	pool: pg.Pool,
	range: {
		fromBlock: bigint;
		toBlock: bigint;
		history: Extract<FabxHistory, { ok: true }>;
	},
	reviewed: Reviewed,
): Promise<FabxState> {
	const { fromBlock, toBlock, history: h } = range;
	const client = await pool.connect();
	try {
		await client.query("begin");
		const state = await client.query<{ logs_up_to_block: string }>(
			"select logs_up_to_block from xlayer_state for update",
		);
		const stored = state.rows[0]
			? BigInt(state.rows[0].logs_up_to_block)
			: null;
		if (stored === null && fromBlock !== FABX_FIRST_BLOCK)
			throw new Error(
				`FabX's first range must start at block ${FABX_FIRST_BLOCK}; this one starts at ${fromBlock}`,
			);
		if (stored !== null && fromBlock > stored + 1n)
			throw new Error(
				`FabX's logs are stored up to block ${stored}; this range starts at ${fromBlock}`,
			);

		await client.query(
			`insert into xlayer_circuits (processor, id, taped_out_block, taped_out_tx, taped_out_log, taped_out_time, taped_out_by)
			 select * from unnest($1::text[], $2::numeric[], $3::bigint[], $4::int[], $5::int[], $6::bigint[], $7::text[])
			 on conflict do nothing`,
			[
				h.tapeOuts.map((t) => t.processor),
				h.tapeOuts.map((t) => t.id.toString()),
				h.tapeOuts.map((t) => t.at.block.toString()),
				h.tapeOuts.map((t) => t.at.tx),
				h.tapeOuts.map((t) => t.at.log),
				h.tapeOuts.map((t) => t.time.toString()),
				h.tapeOuts.map((t) => t.tapedOutBy),
			],
		);
		await client.query(
			`insert into fabx_design_commitments
			   (block, tx, log, tx_hash, block_time, commitment, designer, circuits, claimed_block, first_unused_id)
			 select * from unnest($1::bigint[], $2::int[], $3::int[], $4::bytea[], $5::bigint[], $6::bytea[],
			   $7::text[], $8::text[], $9::bigint[], $10::numeric[])
			 on conflict do nothing`,
			[
				h.commitments.map((c) => c.at.block.toString()),
				h.commitments.map((c) => c.at.tx),
				h.commitments.map((c) => c.at.log),
				h.commitments.map((c) => bytes(c.txHash)),
				h.commitments.map((c) => c.time.toString()),
				h.commitments.map((c) => bytes(c.commitment)),
				h.commitments.map((c) => c.designer),
				h.commitments.map((c) => c.circuits),
				h.commitments.map((c) => c.claimedBlock.toString()),
				h.commitments.map((c) => c.firstUnusedId.toString()),
			],
		);
		await client.query(
			`insert into fabx_starts (block, tx, log, key, processor, id, registrant)
			 select * from unnest($1::bigint[], $2::int[], $3::int[], $4::bytea[], $5::text[], $6::numeric[], $7::text[])
			 on conflict do nothing`,
			[
				h.starts.map((s) => s.at.block.toString()),
				h.starts.map((s) => s.at.tx),
				h.starts.map((s) => s.at.log),
				h.starts.map((s) => bytes(s.key)),
				h.starts.map((s) => s.processor),
				h.starts.map((s) => s.id.toString()),
				h.starts.map((s) => s.registrant),
			],
		);
		await client.query(
			`insert into fabx_contract_events (block, tx, log, tx_hash, block_time, kind, detail)
			 select * from unnest($1::bigint[], $2::int[], $3::int[], $4::bytea[], $5::bigint[], $6::text[], $7::jsonb[])
			 on conflict do nothing`,
			[
				h.contractEvents.map((e) => e.at.block.toString()),
				h.contractEvents.map((e) => e.at.tx),
				h.contractEvents.map((e) => e.at.log),
				h.contractEvents.map((e) => bytes(e.txHash)),
				h.contractEvents.map((e) => e.time.toString()),
				h.contractEvents.map((e) => e.kind),
				h.contractEvents.map((e) => JSON.stringify(e.detail)),
			],
		);

		if (stored === null)
			await client.query(
				`insert into xlayer_state (logs_up_to_block, reviewed_implementation, reviewed_at_block)
				 values ($1, $2, $3)`,
				[
					toBlock.toString(),
					reviewed.implementation.toLowerCase(),
					reviewed.atBlock.toString(),
				],
			);
		else if (toBlock > stored)
			await client.query("update xlayer_state set logs_up_to_block = $1", [
				toBlock.toString(),
			]);

		// The first freezing change after the reviewed block; once frozen, it stays at that block
		await client.query(
			`update xlayer_state set frozen_at_block = (
			   select min(block) from fabx_contract_events
			   where kind = any($1::text[]) and block > xlayer_state.reviewed_at_block)
			 where frozen_at_block is null`,
			[FREEZING],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
	const after = await readFabxState(pool);
	if (!after) throw new Error("FabX's state wasn't saved");
	return after;
}

/**
 * Saves FabX's miner records with each commitment confirmed or not by FabX's stored events
 * (2026-11-25-fabx-commitment-designer.md). The read must cover every stored circuit, at a block
 * FabX's events are stored up to: a later block could hold a commitment whose event isn't stored
 * yet. A confirmed commitment is kept and never checked again while its block stays the same
 * (2026-11-25-fabx-copy-check.md, decision 5). Miners FabX no longer reports are removed.
 */
export async function saveFabxMiners(
	pool: pg.Pool,
	read: Extract<FabxMinersRead, { complete: true }>,
): Promise<{ confirmed: number; unconfirmed: number; none: number }> {
	const client = await pool.connect();
	const counts = { confirmed: 0, unconfirmed: 0, none: 0 };
	try {
		await client.query("begin");
		const state = await client.query<{ logs_up_to_block: string }>(
			"select logs_up_to_block from xlayer_state for update",
		);
		const stored = state.rows[0]
			? BigInt(state.rows[0].logs_up_to_block)
			: null;
		if (stored === null) throw new Error("FabX's history isn't stored yet");
		if (read.block > stored)
			throw new Error(
				`FabX's events are stored up to block ${stored}; miners read at ${read.block} could miss a commitment's event`,
			);
		const circuits = Number(
			(
				await client.query<{ n: string }>(
					"select count(*) as n from xlayer_circuits",
				)
			).rows[0]!.n,
		);
		const covered = read.miners.length + read.notMiners;
		if (covered !== circuits)
			throw new Error(
				`the read covers ${covered} circuits; ${circuits} are stored`,
			);

		// A confirmed commitment is kept, with its event, while its block stays the same
		const kept = new Map(
			(
				await client.query<{
					id: string;
					commit_block: string;
					confirmed_by_block: string;
					confirmed_by_tx: number;
					confirmed_by_log: number;
					commitment_time: string;
				}>(
					`select id, commit_block, confirmed_by_block, confirmed_by_tx, confirmed_by_log, commitment_time
					 from fabx_miners where commitment_status = 'confirmed'`,
				)
			).rows.map((r) => [r.id, r]),
		);
		const blocks = [
			...new Set(
				read.miners
					.filter((m) => m.commitBlock > 0n)
					.map((m) => m.commitBlock.toString()),
			),
		];
		const events = new Map<
			string,
			(CommitmentEvent & { tx: number; log: number })[]
		>();
		for (const r of (
			await client.query<{
				block: string;
				tx: number;
				log: number;
				block_time: string;
				designer: string;
				circuits: string;
				claimed_block: string;
				first_unused_id: string;
			}>(
				`select block, tx, log, block_time, designer, circuits, claimed_block, first_unused_id
				 from fabx_design_commitments where block = any($1::bigint[])`,
				[blocks],
			)
		).rows) {
			const e = {
				at: { block: BigInt(r.block), tx: r.tx, log: r.log },
				tx: r.tx,
				log: r.log,
				time: BigInt(r.block_time),
				designer: r.designer as Address,
				circuits: r.circuits as Address,
				claimedBlock: BigInt(r.claimed_block),
				firstUnusedId: BigInt(r.first_unused_id),
			};
			(events.get(r.block) ?? events.set(r.block, []).get(r.block)!).push(e);
		}
		const starters = new Map<string, Set<Address>>();
		for (const r of (
			await client.query<{ processor: string; id: string; registrant: string }>(
				"select distinct processor, id, registrant from fabx_starts",
			)
		).rows) {
			const k = `${r.processor}/${r.id}`;
			(starters.get(k) ?? starters.set(k, new Set()).get(k)!).add(
				r.registrant as Address,
			);
		}

		for (const m of read.miners) {
			const id = m.id.toString();
			const was = kept.get(id);
			const keep =
				was !== undefined &&
				BigInt(was.commit_block) === m.commitBlock &&
				m.commitBlock > 0n;
			const check = keep
				? null
				: confirmCommitment(
						m,
						events.get(m.commitBlock.toString()) ?? [],
						starters.get(`${m.processor}/${id}`) ?? new Set(),
					);
			const status = keep ? "confirmed" : check!.status;
			counts[status]++;
			const by =
				keep && was
					? {
							block: was.confirmed_by_block,
							tx: was.confirmed_by_tx,
							log: was.confirmed_by_log,
							time: was.commitment_time,
						}
					: check?.status === "confirmed"
						? {
								block: check.by.at.block.toString(),
								tx: check.by.at.tx,
								log: check.by.at.log,
								time: check.by.time.toString(),
							}
						: null;
			await client.query(
				`insert into fabx_miners (processor, id, key, status, registrant, task_id, commit_block, first_unused_id,
				   read_at_block, commitment_status, confirmed_by_block, confirmed_by_tx, confirmed_by_log, commitment_time)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
				 on conflict (processor, id) do update set
				   key = excluded.key, status = excluded.status, registrant = excluded.registrant,
				   task_id = excluded.task_id, first_unused_id = excluded.first_unused_id,
				   read_at_block = excluded.read_at_block, commit_block = excluded.commit_block,
				   commitment_status = excluded.commitment_status,
				   confirmed_by_block = excluded.confirmed_by_block, confirmed_by_tx = excluded.confirmed_by_tx,
				   confirmed_by_log = excluded.confirmed_by_log, commitment_time = excluded.commitment_time,
				   claimed_time = case when fabx_miners.commit_block = excluded.commit_block
				     and excluded.commitment_status = 'unconfirmed' then fabx_miners.claimed_time end`,
				[
					m.processor,
					id,
					Buffer.from(m.key.slice(2), "hex"),
					m.status,
					m.registrant,
					m.taskId,
					m.commitBlock.toString(),
					m.firstUnusedId.toString(),
					read.block.toString(),
					status,
					by?.block ?? null,
					by?.tx ?? null,
					by?.log ?? null,
					by?.time ?? null,
				],
			);
		}
		await client.query(
			"delete from fabx_miners where not (id = any($1::numeric[]))",
			[read.miners.map((m) => m.id.toString())],
		);
		await client.query("update xlayer_state set miners_read_at_block = $1", [
			read.block.toString(),
		]);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
	return counts;
}

export async function readFabxState(pool: pg.Pool): Promise<FabxState | null> {
	const { rows } = await pool.query<{
		logs_up_to_block: string;
		reviewed_implementation: string;
		reviewed_at_block: string;
		frozen_at_block: string | null;
	}>(
		"select logs_up_to_block, reviewed_implementation, reviewed_at_block, frozen_at_block from xlayer_state",
	);
	const r = rows[0];
	if (!r) return null;
	return {
		logsUpToBlock: BigInt(r.logs_up_to_block),
		reviewed: {
			implementation: r.reviewed_implementation,
			atBlock: BigInt(r.reviewed_at_block),
		},
		frozenAtBlock:
			r.frozen_at_block === null ? null : BigInt(r.frozen_at_block),
	};
}

/**
 * Reads, from X Layer, the second each unconfirmed commitment claims: its commitBlock's timestamp
 * (2026-11-25-cross-chain-check.md, decision 3). Each block is read once; a failed read throws and
 * stores nothing, and the index isn't loaded while any is missing.
 */
export async function fillFabxClaimTimes(
	pool: pg.Pool,
	client: PublicClient,
): Promise<{ filled: number }> {
	const { rows } = await pool.query<{ commit_block: string }>(
		`select distinct commit_block from fabx_miners
		 where commitment_status = 'unconfirmed' and claimed_time is null order by commit_block`,
	);
	let filled = 0;
	for (const r of rows) {
		const block = await client.getBlock({
			blockNumber: BigInt(r.commit_block),
		});
		const updated = await pool.query(
			`update fabx_miners set claimed_time = $2
			 where commit_block = $1 and commitment_status = 'unconfirmed' and claimed_time is null`,
			[r.commit_block, block.timestamp.toString()],
		);
		filled += updated.rowCount ?? 0;
	}
	return { filled };
}

const bytes = (hex: string) => Buffer.from(hex.slice(2), "hex");

/**
 * Reads each stored FabX circuit's netlist once, at the block FabX's history is stored up to,
 * with the same reader, hash and rule version as BNB Chain's (2026-11-25-fabx-storage.md).
 * A failed read stores nothing and is tried again on the next run.
 */
export async function backfillFabxNetlists(
	pool: pg.Pool,
	client: PublicClient,
	options: BackfillOptions = {},
): Promise<BackfillResult> {
	const state = await readFabxState(pool);
	if (!state) throw new Error("FabX's history isn't stored: save it first");
	return backfillTable(
		pool,
		client,
		"xlayer_circuits",
		state.logsUpToBlock,
		options,
	);
}
