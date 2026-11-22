// The stored results (docs/decisions/2026-11-21-stored-results.md): every miner's and listed
// circuit's latest complete result, with the index block it was built at. Saved whole per rebuild
// or not at all; a circuit whose build failed keeps its last complete row.

import {
	type Originality,
	parseOriginality,
	serialiseOriginality,
} from "@foreman/contract";
import type { CircuitId } from "@foreman/originality";
import type pg from "pg";

export interface StoredResult {
	originality: Originality;
	/** = originality.index.upToBlock.block */
	indexBlock: bigint;
	/** When the job built it, Unix seconds. */
	builtAt: bigint;
}

export interface ResultsState {
	/** The index block the last rebuild of changes covered; null before the first rebuild. */
	changesUpTo: bigint | null;
	fullUpTo: bigint | null;
	/** When the last full rebuild ran, Unix seconds. */
	fullAt: bigint | null;
}

export async function saveResults(
	pool: pg.Pool,
	input: {
		/** What the rebuild covered: partial (a build failed) saves rows but moves no block, so the next run retries. */
		mode: "full" | "changes" | "partial";
		indexBlock: bigint;
		builtAt: bigint;
		results: Originality[];
		/** Circuits that are no longer a miner or listed: their rows go. */
		remove: CircuitId[];
	},
): Promise<void> {
	for (const o of input.results) {
		if (o.scope === "pasted") {
			throw new Error(
				`${name(o.circuit)}: a pasted result is never stored (2026-11-21-stored-results.md)`,
			);
		}
		if (o.index.upToBlock.block !== input.indexBlock) {
			throw new Error(
				`${name(o.circuit)} was built at block ${o.index.upToBlock.block}, not the rebuild's ${input.indexBlock}`,
			);
		}
	}
	const db = await pool.connect();
	try {
		await db.query("begin");
		for (const o of input.results) {
			await db.query(
				`insert into circuit_results (processor, id, scope, kind, can_mine, originality, index_block, built_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8)
				 on conflict (processor, id) do update set scope = excluded.scope, kind = excluded.kind,
				   can_mine = excluded.can_mine, originality = excluded.originality,
				   index_block = excluded.index_block, built_at = excluded.built_at`,
				[
					o.circuit.processor,
					o.circuit.tokenId.toString(),
					o.scope,
					o.result.verdict,
					canMine(o),
					JSON.stringify(serialiseOriginality(o, name(o.circuit))),
					input.indexBlock.toString(),
					input.builtAt.toString(),
				],
			);
		}
		for (const c of input.remove) {
			await db.query(
				"delete from circuit_results where processor = $1 and id = $2",
				[c.processor.toLowerCase(), c.id.toString()],
			);
		}
		const state =
			input.mode === "full"
				? await db.query(
						`update index_state set results_changes_up_to_block = $1, results_full_up_to_block = $1,
						   results_full_at = $2`,
						[input.indexBlock.toString(), input.builtAt.toString()],
					)
				: input.mode === "changes"
					? await db.query(
							"update index_state set results_changes_up_to_block = $1",
							[input.indexBlock.toString()],
						)
					: await db.query("select 1 from index_state");
		if (state.rowCount !== 1) {
			throw new Error("The index is not filled yet: no results without it");
		}
		await db.query("commit");
	} catch (error) {
		await db.query("rollback");
		throw error;
	} finally {
		db.release();
	}
}

/** Every circuit with a stored result. */
export async function readStoredCircuits(pool: pg.Pool): Promise<CircuitId[]> {
	const { rows } = await pool.query<{ processor: string; id: string }>(
		"select processor, id::text from circuit_results order by processor, id",
	);
	return rows.map((r) => ({
		processor: r.processor as CircuitId["processor"],
		id: BigInt(r.id),
	}));
}

/** A circuit's stored result, parsed and re-checked; null when it has none. */
export async function readStoredResult(
	pool: pg.Pool,
	circuit: CircuitId,
): Promise<StoredResult | null> {
	const { rows } = await pool.query<{
		originality: string;
		index_block: string;
		built_at: string;
	}>(
		`select originality, index_block::text, built_at::text from circuit_results
		 where processor = $1 and id = $2`,
		[circuit.processor.toLowerCase(), circuit.id.toString()],
	);
	const row = rows[0];
	if (!row) return null;
	return {
		originality: parseOriginality(JSON.parse(row.originality), name(circuit)),
		indexBlock: BigInt(row.index_block),
		builtAt: BigInt(row.built_at),
	};
}

/**
 * The index the newest stored result was checked against: how many circuits, up to which block.
 * A page of many results states it once; each row still carries its own. Null before any result.
 */
export async function readResultsIndex(
	pool: pg.Pool,
): Promise<Originality["index"] | null> {
	const { rows } = await pool.query<{
		processor: string;
		id: string;
		originality: string;
	}>(
		`select processor, id::text, originality from circuit_results
		 order by index_block desc, built_at desc, processor, id limit 1`,
	);
	const row = rows[0];
	if (!row) return null;
	return parseOriginality(
		JSON.parse(row.originality),
		`stored result ${row.processor} #${row.id}`,
	).index;
}

/**
 * Every circuit the index changed after `block`, with every circuit sharing a changed circuit's
 * netlist hash: a new tape-out, a netlist or design commitment read, a miner start, a revoke or a
 * new listing (2026-11-21-stored-results.md, decision 2). Not only miners and listed circuits: the
 * caller keeps those.
 */
export async function circuitsTouchedSince(
	pool: pg.Pool,
	block: bigint,
): Promise<CircuitId[]> {
	const { rows } = await pool.query<{ processor: string; id: string }>(
		`with touched as (
		   select processor, id from circuits where taped_out_block > $1 or netlist_read_at_block > $1
		   union
		   select processor, id from miners
		   where last_started_block > $1 or commitment_read_at_block > $1 or revoked_block > $1
		   union
		   select processor, token_id from market_listings where listed_block > $1 and open
		 )
		 select processor, id::text from touched
		 union
		 select c.processor, c.id::text from circuits c
		 where c.netlist_hash in (
		   select t.netlist_hash from circuits t join touched using (processor, id)
		   where t.netlist_hash is not null
		 )
		 order by 1, 2`,
		[block.toString()],
	);
	return rows.map((r) => ({
		processor: r.processor as CircuitId["processor"],
		id: BigInt(r.id),
	}));
}

export async function readResultsState(pool: pg.Pool): Promise<ResultsState> {
	const { rows } = await pool.query<{
		results_changes_up_to_block: string | null;
		results_full_up_to_block: string | null;
		results_full_at: string | null;
	}>(
		`select results_changes_up_to_block::text, results_full_up_to_block::text,
		   results_full_at::text from index_state`,
	);
	const r = rows[0];
	const big = (v: string | null | undefined) => (v ? BigInt(v) : null);
	return {
		changesUpTo: big(r?.results_changes_up_to_block),
		fullUpTo: big(r?.results_full_up_to_block),
		fullAt: big(r?.results_full_at),
	};
}

function canMine(o: Originality): string {
	const fact = o.facts.find((f) => f.fact === "can-mine");
	if (fact?.fact !== "can-mine") {
		throw new Error(
			`${name(o.circuit)}: a result carries exactly one can-mine fact`,
		);
	}
	return fact.state;
}

const name = (c: { processor: string; tokenId?: bigint; id?: bigint }) =>
	`${c.processor.toLowerCase()}/${c.tokenId ?? c.id}`;
