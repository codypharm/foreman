// The netlist backfill: reads each indexed circuit's netlist once, at the index's block, and
// stores its bytes, counts and both hashes with the hash rule's version
// (docs/decisions/2026-11-20-circuit-index.md, decision 4). Netlists can't change once taped
// out, so a circuit that has been read is never read again. Read only on chain.

import {
	type CircuitId,
	HASH_RULE_VERSION,
	hashNetlist,
	readNetlist,
} from "@foreman/originality";
import type pg from "pg";
import type { Address, Hex, PublicClient } from "viem";

export interface BackfillResult {
	/** The block every netlist was read at: the index's last block. */
	atBlock: bigint;
	read: number;
	/** Netlists the chain returned but that don't decode: stored, shown as "Can't check". */
	unreadable: number;
	/** Reads that failed (RPC errors): nothing stored, tried again on the next run. */
	failed: { circuit: CircuitId; detail: string }[];
	/** Circuits still not read after this run. */
	remaining: number;
}

export type StoredNetlist =
	| { status: "not-read" }
	| { status: "unreadable"; readAtBlock: bigint; detail: string }
	| {
			status: "read";
			readAtBlock: bigint;
			nIn: number;
			nOut: number;
			nState: number;
			gateCount: number;
			bytes: Hex;
			netlistHash: Hex;
			byteHash: Hex;
			hashRule: string;
	  };

export interface BackfillOptions {
	/** At most this many circuits in this run. */
	limit?: number;
	/** Netlists read at once. */
	concurrency?: number;
	onProgress?: (done: number, total: number) => void;
}

export async function backfillNetlists(
	pool: pg.Pool,
	client: PublicClient,
	options: BackfillOptions = {},
): Promise<BackfillResult> {
	const state = await pool.query<{ up_to_block: string }>(
		"select up_to_block from index_state",
	);
	const row = state.rows[0];
	if (!row) throw new Error("the index is empty: save a tape-out scan first");
	return backfillTable(
		pool,
		client,
		"circuits",
		BigInt(row.up_to_block),
		options,
	);
}

/**
 * The shared loop: BNB Chain's circuits and FabX's X Layer circuits (xlayer_circuits, the same
 * netlist columns: 2026-11-25-fabx-storage.md) are read the same way, with the same hash rule.
 */
export async function backfillTable(
	pool: pg.Pool,
	client: PublicClient,
	table: "circuits" | "xlayer_circuits",
	atBlock: bigint,
	options: BackfillOptions,
): Promise<BackfillResult> {
	const unread = await pool.query<{ processor: string; id: string }>(
		`select processor, id from ${table} where netlist_status is null
		 order by taped_out_block, taped_out_tx, taped_out_log limit $1`,
		[options.limit ?? null],
	);
	const circuits = unread.rows.map((r) => ({
		processor: r.processor as Address,
		id: BigInt(r.id),
	}));

	const result: BackfillResult = {
		atBlock,
		read: 0,
		unreadable: 0,
		failed: [],
		remaining: 0,
	};
	const step = options.concurrency ?? 20;
	for (let i = 0; i < circuits.length; i += step) {
		const batch = circuits.slice(i, i + step);
		const reads = await Promise.all(
			batch.map((c) => readNetlist(client, c, { blockNumber: atBlock })),
		);
		for (const [k, r] of reads.entries()) {
			const circuit = batch[k] as CircuitId;
			const key = [circuit.processor, circuit.id.toString()];
			if (r.readable) {
				const n = r.netlist;
				const h = hashNetlist(n);
				await pool.query(
					`update ${table} set netlist_status = 'read', netlist_read_at_block = $3,
					   n_in = $4, n_out = $5, n_state = $6, gate_count = $7, netlist = $8,
					   netlist_hash = $9, byte_hash = $10, hash_rule = $11
					 where processor = $1 and id = $2 and netlist_status is null`,
					[
						...key,
						atBlock.toString(),
						n.nIn,
						n.nOut,
						n.nState,
						n.gateCount,
						bytes(n.bytes),
						bytes(h.netlistHash),
						bytes(h.byteHash),
						HASH_RULE_VERSION,
					],
				);
				result.read++;
			} else if (r.reason === "netlist-unreadable") {
				await pool.query(
					`update ${table} set netlist_status = 'unreadable', netlist_read_at_block = $3,
					   netlist_detail = $4
					 where processor = $1 and id = $2 and netlist_status is null`,
					[...key, atBlock.toString(), r.detail],
				);
				result.unreadable++;
			} else {
				result.failed.push({ circuit, detail: r.detail });
			}
		}
		options.onProgress?.(Math.min(i + step, circuits.length), circuits.length);
	}

	const left = await pool.query<{ n: string }>(
		`select count(*) as n from ${table} where netlist_status is null`,
	);
	result.remaining = Number(left.rows[0]?.n ?? 0);
	return result;
}

export async function readStoredNetlist(
	pool: pg.Pool,
	circuit: CircuitId,
): Promise<StoredNetlist | null> {
	const r = await pool.query<{
		netlist_status: "read" | "unreadable" | null;
		netlist_read_at_block: string | null;
		netlist_detail: string | null;
		n_in: number;
		n_out: number;
		n_state: number;
		gate_count: number;
		netlist: Buffer;
		netlist_hash: Buffer;
		byte_hash: Buffer;
		hash_rule: string;
	}>(
		`select netlist_status, netlist_read_at_block, netlist_detail, n_in, n_out, n_state,
		   gate_count, netlist, netlist_hash, byte_hash, hash_rule
		 from circuits where processor = $1 and id = $2`,
		[circuit.processor.toLowerCase(), circuit.id.toString()],
	);
	const row = r.rows[0];
	if (!row) return null;
	if (row.netlist_status === null) return { status: "not-read" };
	const readAtBlock = BigInt(row.netlist_read_at_block as string);
	if (row.netlist_status === "unreadable") {
		return {
			status: "unreadable",
			readAtBlock,
			detail: row.netlist_detail as string,
		};
	}
	return {
		status: "read",
		readAtBlock,
		nIn: row.n_in,
		nOut: row.n_out,
		nState: row.n_state,
		gateCount: row.gate_count,
		bytes: hex(row.netlist),
		netlistHash: hex(row.netlist_hash),
		byteHash: hex(row.byte_hash),
		hashRule: row.hash_rule,
	};
}

const bytes = (h: string) => Buffer.from(h.slice(2), "hex");
const hex = (b: Buffer): Hex => `0x${b.toString("hex")}`;
