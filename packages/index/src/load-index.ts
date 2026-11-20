// Loads the stored index into the shape the copy check compares against
// (packages/originality/src/check-copy.ts). Only circuits whose netlist was read are compared,
// so "No earlier copy found among N circuits" counts only those; the rest are counted apart.

import { parseHex32 } from "@foreman/contract";
import type { CircuitIndex, IndexEntry } from "@foreman/originality";
import type pg from "pg";
import type { Address } from "viem";

export type LoadedIndex =
	| {
			ready: true;
			index: CircuitIndex;
			/** Indexed circuits left out of the comparison. */
			notCompared: { unread: number; unreadable: number };
	  }
	/**
	 * Not ready: without every miner's commitment, a miner that committed first could be called
	 * the copy of a circuit taped out before it (2026-11-20-verdict-scope-and-earliest-design.md,
	 * decision 4).
	 */
	| {
			ready: false;
			reason:
				| "index-empty"
				| "miners-not-indexed"
				| "miners-behind"
				| "commitments-unread"
				| "times-missing";
			detail: string;
	  };

export async function loadCircuitIndex(pool: pg.Pool): Promise<LoadedIndex> {
	const state = await pool.query<{
		up_to_block: string;
		miners_up_to_block: string | null;
	}>("select up_to_block, miners_up_to_block from index_state");
	const row = state.rows[0];
	if (!row) {
		return {
			ready: false,
			reason: "index-empty",
			detail: "no tape-out scan has been saved",
		};
	}
	if (row.miners_up_to_block === null) {
		return {
			ready: false,
			reason: "miners-not-indexed",
			detail: `miner starts are not indexed; tape-outs are, up to block ${row.up_to_block}`,
		};
	}
	if (BigInt(row.miners_up_to_block) < BigInt(row.up_to_block)) {
		return {
			ready: false,
			reason: "miners-behind",
			detail: `miner starts are read up to block ${row.miners_up_to_block}, tape-outs up to ${row.up_to_block}`,
		};
	}
	const unread = await pool.query<{ n: string }>(
		"select count(*) as n from miners where commitment_status is null",
	);
	const n = Number(unread.rows[0]?.n ?? 0);
	if (n > 0) {
		return {
			ready: false,
			reason: "commitments-unread",
			detail: `${n} miners' design commitments are not read yet`,
		};
	}
	// A result shows dates, never a blank one: rows saved before migration 004 must be filled first
	const missing = await pool.query<{ circuits: string; commitments: string }>(
		`select (select count(*) from circuits where taped_out_time is null) as circuits,
		   (select count(*) from miners
		    where design_committed_at is not null and design_committed_time is null) as commitments`,
	);
	const noTime = {
		circuits: Number(missing.rows[0]?.circuits ?? 0),
		commitments: Number(missing.rows[0]?.commitments ?? 0),
	};
	if (noTime.circuits > 0 || noTime.commitments > 0) {
		return {
			ready: false,
			reason: "times-missing",
			detail: `no time stored for ${noTime.circuits} circuit tape-out(s) and ${noTime.commitments} design commitment(s)`,
		};
	}
	const upToBlock = BigInt(row.up_to_block);
	const rows = await pool.query<{
		processor: string;
		id: string;
		netlist_hash: Buffer;
		byte_hash: Buffer;
		gate_count: number;
		taped_out_block: string;
		taped_out_tx: number;
		taped_out_log: number;
		taped_out_time: string;
		taped_out_by: string;
		design_committed_at: string | null;
		design_committed_time: string | null;
	}>(
		`select c.processor, c.id, c.netlist_hash, c.byte_hash, c.gate_count, c.taped_out_block,
		   c.taped_out_tx, c.taped_out_log, c.taped_out_time, c.taped_out_by,
		   m.design_committed_at, m.design_committed_time
		 from circuits c left join miners m on m.processor = c.processor and m.id = c.id
		 where c.netlist_status = 'read'
		 order by c.taped_out_block, c.taped_out_tx, c.taped_out_log`,
	);
	const entries: IndexEntry[] = rows.rows.map((r) => ({
		circuit: { processor: r.processor as Address, id: BigInt(r.id) },
		netlistHash: parseHex32(
			`0x${r.netlist_hash.toString("hex")}`,
			"netlist_hash",
		),
		byteHash: parseHex32(`0x${r.byte_hash.toString("hex")}`, "byte_hash"),
		gateCount: r.gate_count,
		tapedOutAt: {
			block: BigInt(r.taped_out_block),
			txIndex: r.taped_out_tx,
			logIndex: r.taped_out_log,
			time: BigInt(r.taped_out_time),
		},
		tapedOutBy: r.taped_out_by as Address,
		designCommittedAt:
			r.design_committed_at === null
				? null
				: {
						block: BigInt(r.design_committed_at),
						time: BigInt(r.design_committed_time as string),
					},
	}));
	const left = await pool.query<{ unread: string; unreadable: string }>(
		`select count(*) filter (where netlist_status is null) as unread,
		   count(*) filter (where netlist_status = 'unreadable') as unreadable
		 from circuits`,
	);
	const counts = left.rows[0];
	return {
		ready: true,
		index: { entries, upToBlock },
		notCompared: {
			unread: Number(counts?.unread),
			unreadable: Number(counts?.unreadable),
		},
	};
}
