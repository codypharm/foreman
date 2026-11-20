// Measures what the size floor is chosen from (docs/decisions/2026-11-20-copy-and-wrapper-rules.md,
// decision 3; 2026-11-20-circuit-index.md, decision 6): at each gate count, how many circuits
// have an earlier identical circuit (the ones the copy check would call a copy, or too small to
// tell), and how many of those were taped out by a different address than the earliest one.
// Pure wrappers are left out: they are judged before the copy check. Reads the local index only.
//
//   pnpm --filter @foreman/index measure-floor
//
// Writes data/size-floor-<block>.json at the repository root (uncommitted, like all of data/).

import { mkdirSync, writeFileSync } from "node:fs";
import { decodeNetlist } from "@foreman/originality";
import pg from "pg";
import type { Hex } from "viem";
import { migrate } from "../src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");
const pool = new pg.Pool({ connectionString: DATABASE_URL });

interface Row {
	processor: string;
	id: string;
	hash: string;
	gate_count: number;
	taped_out_by: string;
	block: string;
	tx: number;
	log: number;
	committed: string | null;
	is_miner: boolean;
	starts_with_ref: boolean;
}

try {
	await migrate(pool);
	const state = await pool.query<{
		up_to_block: string;
		miners_up_to_block: string | null;
	}>("select up_to_block, miners_up_to_block from index_state");
	const s = state.rows[0];
	if (!s) throw new Error("the index is empty");
	const unreadCommitments = Number(
		(
			await pool.query<{ n: string }>(
				"select count(*) as n from miners where commitment_status is null",
			)
		).rows[0]?.n ?? 0,
	);
	const commitmentsIncluded =
		s.miners_up_to_block !== null &&
		BigInt(s.miners_up_to_block) >= BigInt(s.up_to_block) &&
		unreadCommitments === 0;

	const rows = (
		await pool.query<Row>(
			`select c.processor, c.id, encode(c.netlist_hash, 'hex') as hash, c.gate_count, c.taped_out_by,
			   c.taped_out_block as block, c.taped_out_tx as tx, c.taped_out_log as log,
			   m.design_committed_at as committed, m.key is not null as is_miner,
			   get_byte(c.netlist, 0) = 2 as starts_with_ref
			 from circuits c left join miners m on m.processor = c.processor and m.id = c.id
			 where c.netlist_status = 'read'`,
		)
	).rows;
	const notCompared = (
		await pool.query<{ unread: string; unreadable: string }>(
			`select count(*) filter (where netlist_status is null) as unread,
			   count(*) filter (where netlist_status = 'unreadable') as unreadable from circuits`,
		)
	).rows[0];

	// Pure wrappers: every record is a REF. Only netlists starting with a REF can be one.
	const pureWrappers = new Set<string>();
	const candidates = await pool.query<{
		processor: string;
		id: string;
		netlist: Buffer;
	}>(
		"select processor, id, netlist from circuits where netlist_status = 'read' and get_byte(netlist, 0) = 2",
	);
	for (const c of candidates.rows) {
		const d = decodeNetlist(`0x${c.netlist.toString("hex")}` as Hex);
		if ("records" in d && d.records.every((r) => r.op === "ref")) {
			pureWrappers.add(`${c.processor}/${c.id}`);
		}
	}

	const designTime = (r: Row) => {
		const t = BigInt(r.block);
		return commitmentsIncluded &&
			r.committed !== null &&
			BigInt(r.committed) < t
			? BigInt(r.committed)
			: t;
	};
	const groups = new Map<string, Row[]>();
	for (const r of rows) {
		if (pureWrappers.has(`${r.processor}/${r.id}`)) continue;
		groups.set(r.hash, [...(groups.get(r.hash) ?? []), r]);
	}

	interface Bucket {
		gateCount: number;
		circuits: number;
		miners: number;
		laterIdentical: number;
		laterIdenticalOtherAddress: number;
		minersLaterIdentical: number;
		minersLaterIdenticalOtherAddress: number;
		identicalGroups: number;
		groupsAcrossAddresses: number;
	}
	const buckets = new Map<number, Bucket>();
	const bucket = (g: number) => {
		let b = buckets.get(g);
		if (!b) {
			b = {
				gateCount: g,
				circuits: 0,
				miners: 0,
				laterIdentical: 0,
				laterIdenticalOtherAddress: 0,
				minersLaterIdentical: 0,
				minersLaterIdenticalOtherAddress: 0,
				identicalGroups: 0,
				groupsAcrossAddresses: 0,
			};
			buckets.set(g, b);
		}
		return b;
	};
	let compared = 0;
	for (const members of groups.values()) {
		members.sort((a, b) => {
			const d = designTime(a) - designTime(b);
			if (d !== 0n) return d < 0n ? -1 : 1;
			const bd = BigInt(a.block) - BigInt(b.block);
			if (bd !== 0n) return bd < 0n ? -1 : 1;
			return a.tx - b.tx || a.log - b.log;
		});
		const earliest = members[0] as Row;
		for (const m of members) {
			compared++;
			bucket(m.gate_count).circuits++;
			if (m.is_miner) bucket(m.gate_count).miners++;
		}
		if (members.length < 2) continue;
		const b0 = bucket(earliest.gate_count);
		b0.identicalGroups++;
		if (new Set(members.map((m) => m.taped_out_by)).size > 1)
			b0.groupsAcrossAddresses++;
		for (const m of members.slice(1)) {
			const b = bucket(m.gate_count);
			const other = m.taped_out_by !== earliest.taped_out_by;
			b.laterIdentical++;
			if (other) b.laterIdenticalOtherAddress++;
			if (m.is_miner) {
				b.minersLaterIdentical++;
				if (other) b.minersLaterIdenticalOtherAddress++;
			}
		}
	}

	const result = {
		measuredAt: new Date().toISOString(),
		indexUpToBlock: s.up_to_block,
		ordering: commitmentsIncluded
			? "earliest proven design"
			: "tape-out only (commitments not indexed yet)",
		circuitsCompared: compared,
		pureWrappersLeftOut: pureWrappers.size,
		notRead: Number(notCompared?.unread ?? 0),
		unreadable: Number(notCompared?.unreadable ?? 0),
		minersIndexed: s.miners_up_to_block !== null,
		byGateCount: [...buckets.values()].sort(
			(a, b) => a.gateCount - b.gateCount,
		),
	};
	const dir = new URL("../../../data/", import.meta.url);
	mkdirSync(dir, { recursive: true });
	const out = new URL(`size-floor-${s.up_to_block}.json`, dir);
	writeFileSync(out, `${JSON.stringify(result, null, "\t")}\n`);

	const ranges = [
		[1, 1],
		[2, 2],
		[3, 3],
		[4, 5],
		[6, 10],
		[11, 20],
		[21, 50],
		[51, 100],
		[101, 200],
		[201, 500],
		[501, 1000],
		[1001, 1e9],
	] as const;
	console.log(
		`${result.ordering}; ${compared} circuits compared, ${pureWrappers.size} pure wrappers left out, ${result.notRead} not read, ${result.unreadable} unreadable`,
	);
	console.log(
		"gates        circuits  later-identical  other-address |   miners  later-identical  other-address",
	);
	for (const [lo, hi] of ranges) {
		const bs = result.byGateCount.filter(
			(b) => b.gateCount >= lo && b.gateCount <= hi,
		);
		const sum = (k: keyof Bucket) =>
			bs.reduce((n, b) => n + (b[k] as number), 0);
		const col = (k: keyof Bucket, w: number) => String(sum(k)).padStart(w);
		const label = lo === hi ? `${lo}` : hi > 1e8 ? `${lo}+` : `${lo}-${hi}`;
		console.log(
			`${label.padEnd(12)} ${col("circuits", 8)}  ${col("laterIdentical", 15)}  ${col("laterIdenticalOtherAddress", 13)} | ${col("miners", 8)}  ${col("minersLaterIdentical", 15)}  ${col("minersLaterIdenticalOtherAddress", 13)}`,
		);
	}
	console.log(`→ ${out.pathname}`);
} finally {
	await pool.end();
}
