// Loads the stored index into the shape the copy check compares against
// (packages/originality/src/check-copy.ts). Only circuits whose netlist was read are compared,
// so "No earlier copy found among N circuits" counts only those; the rest are counted apart.
// Once FabX's history is stored, its circuits are loaded beside BNB Chain's, up to X Layer's
// stored block (2026-11-25-cross-chain-check.md).

import { type CircuitRef, parseAddress, parseHex32 } from "@foreman/contract";
import type { CircuitId, CircuitIndex, IndexEntry } from "@foreman/originality";
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
				| "times-missing"
				/** FabX's miners aren't read at the block its history is stored up to. */
				| "fabx-miners-behind"
				| "fabx-netlists-unread"
				/** An unconfirmed FabX commitment's block time isn't read yet. */
				| "fabx-claim-times-missing";
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
		miner: boolean;
	}>(
		`select c.processor, c.id, c.netlist_hash, c.byte_hash, c.gate_count, c.taped_out_block,
		   c.taped_out_tx, c.taped_out_log, c.taped_out_time, c.taped_out_by,
		   m.design_committed_at, m.design_committed_time, m.key is not null as miner
		 from circuits c left join miners m on m.processor = c.processor and m.id = c.id
		 where c.netlist_status = 'read'
		 order by c.taped_out_block, c.taped_out_tx, c.taped_out_log`,
	);
	const entries: IndexEntry[] = rows.rows.map((r) => ({
		chainId: 56,
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
		miner: r.miner,
		designCommittedAt:
			r.design_committed_at === null
				? null
				: {
						block: BigInt(r.design_committed_at),
						time: BigInt(r.design_committed_time as string),
					},
		unconfirmedCommitment: null,
	}));
	const upTo: CircuitIndex["upTo"] = [{ chainId: 56, block: upToBlock }];
	const fabx = await loadFabx(pool);
	if (fabx.ready === false) return fabx;
	if (fabx.ready === true) {
		entries.push(...fabx.entries);
		upTo.push({ chainId: 196, block: fabx.upToBlock });
	}
	const left = await pool.query<{ unread: string; unreadable: string }>(
		`select count(*) filter (where netlist_status is null) as unread,
		   count(*) filter (where netlist_status = 'unreadable') as unreadable
		 from circuits`,
	);
	const counts = left.rows[0];
	return {
		ready: true,
		index: { entries, upTo },
		notCompared: {
			unread: Number(counts?.unread),
			unreadable:
				Number(counts?.unreadable) +
				(fabx.ready === true ? fabx.unreadable : 0),
		},
	};
}

/** FabX's read circuits, or "absent" before its history is stored. */
async function loadFabx(pool: pg.Pool): Promise<
	| { ready: "absent" }
	| Extract<LoadedIndex, { ready: false }>
	| {
			ready: true;
			entries: IndexEntry[];
			upToBlock: bigint;
			unreadable: number;
	  }
> {
	const state = await pool.query<{
		logs_up_to_block: string;
		miners_read_at_block: string | null;
	}>("select logs_up_to_block, miners_read_at_block from xlayer_state");
	const row = state.rows[0];
	if (!row) return { ready: "absent" };
	if (row.miners_read_at_block !== row.logs_up_to_block) {
		// A circuit taped out after the miners were read could have a commitment nobody checked
		return {
			ready: false,
			reason: "fabx-miners-behind",
			detail: `FabX's miners are read at block ${row.miners_read_at_block ?? "none"}, its history up to ${row.logs_up_to_block}`,
		};
	}
	const counts = (
		await pool.query<{ unread: string; unreadable: string; unclaimed: string }>(
			`select (select count(*) from xlayer_circuits where netlist_status is null) as unread,
			   (select count(*) from xlayer_circuits where netlist_status = 'unreadable') as unreadable,
			   (select count(*) from fabx_miners
			    where commitment_status = 'unconfirmed' and claimed_time is null) as unclaimed`,
		)
	).rows[0];
	if (Number(counts?.unread) > 0) {
		return {
			ready: false,
			reason: "fabx-netlists-unread",
			detail: `${counts?.unread} FabX circuits' netlists are not read yet`,
		};
	}
	if (Number(counts?.unclaimed) > 0) {
		return {
			ready: false,
			reason: "fabx-claim-times-missing",
			detail: `${counts?.unclaimed} unconfirmed FabX commitments have no block time yet`,
		};
	}
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
		commitment_status: string | null;
		commit_block: string | null;
		commitment_time: string | null;
		claimed_time: string | null;
	}>(
		`select x.processor, x.id, x.netlist_hash, x.byte_hash, x.gate_count, x.taped_out_block,
		   x.taped_out_tx, x.taped_out_log, x.taped_out_time, x.taped_out_by,
		   f.commitment_status, f.commit_block, f.commitment_time, f.claimed_time
		 from xlayer_circuits x left join fabx_miners f on f.processor = x.processor and f.id = x.id
		 where x.netlist_status = 'read'
		 order by x.taped_out_block, x.taped_out_tx, x.taped_out_log`,
	);
	const entries: IndexEntry[] = rows.rows.map((r) => {
		const commit = r.commit_block === null ? null : BigInt(r.commit_block);
		return {
			chainId: 196,
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
			miner: r.commitment_status !== null,
			// Only a commitment confirmed by its event counts (2026-11-25-fabx-copy-check.md, decision 5)
			designCommittedAt:
				r.commitment_status === "confirmed" && commit !== null
					? { block: commit, time: BigInt(r.commitment_time as string) }
					: null,
			unconfirmedCommitment:
				r.commitment_status === "unconfirmed" && commit !== null
					? { block: commit, time: BigInt(r.claimed_time as string) }
					: null,
		};
	});
	return {
		ready: true,
		entries,
		upToBlock: BigInt(row.logs_up_to_block),
		unreadable: Number(counts?.unreadable),
	};
}

/**
 * Any indexed circuit as the data contract's CircuitRef, whether or not its netlist could be
 * read, so an unreadable one still gets its "Can't check" result. null when it isn't indexed:
 * the caller's "Can't check: outside the index", never a result (2026-11-20, complete or none).
 */
export async function readCircuitRef(
	pool: pg.Pool,
	circuit: CircuitId,
): Promise<CircuitRef | null> {
	const rows = await pool.query<{
		taped_out_block: string;
		taped_out_tx: number;
		taped_out_log: number;
		taped_out_time: string | null;
		taped_out_by: string;
		design_committed_at: string | null;
		design_committed_time: string | null;
	}>(
		`select c.taped_out_block, c.taped_out_tx, c.taped_out_log, c.taped_out_time, c.taped_out_by,
		   m.design_committed_at, m.design_committed_time
		 from circuits c left join miners m on m.processor = c.processor and m.id = c.id
		 where c.processor = $1 and c.id = $2`,
		[circuit.processor.toLowerCase(), circuit.id.toString()],
	);
	const r = rows.rows[0];
	if (!r) return null;
	if (
		r.taped_out_time === null ||
		(r.design_committed_at !== null && r.design_committed_time === null)
	) {
		throw new Error(
			`${circuit.processor}/${circuit.id} has no stored time yet: run fill-times`,
		);
	}
	return {
		chainId: 56,
		processor: parseAddress(circuit.processor.toLowerCase(), "processor"),
		tokenId: circuit.id,
		tapedOutAt: {
			block: BigInt(r.taped_out_block),
			txIndex: r.taped_out_tx,
			logIndex: r.taped_out_log,
			time: BigInt(r.taped_out_time),
		},
		tapedOutBy: parseAddress(r.taped_out_by, "tapedOutBy"),
		designCommittedAt:
			r.design_committed_at === null
				? null
				: {
						block: BigInt(r.design_committed_at),
						time: BigInt(r.design_committed_time as string),
					},
	};
}
