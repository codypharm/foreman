// Saving the tape-out scan and reading the index back (docs/decisions/2026-11-20-circuit-index.md,
// decisions 2 and 4). A scan is saved in one transaction: all of it, or none of it.

import type {
	ListedProcessor,
	TapeOut,
	TapeOutScan,
} from "@foreman/originality";
import type pg from "pg";
import type { Address } from "viem";

/** Only a complete scan can be saved: a stopped one never reaches the index. */
export type CompleteScan = Extract<TapeOutScan, { complete: true }>;

export interface StoredIndex {
	/** null before the first scan is saved. */
	upToBlock: bigint | null;
	processors: ListedProcessor[];
	/** In chain order: block, transaction index, log index. */
	tapeOuts: TapeOut[];
}

export async function saveScan(
	pool: pg.Pool,
	scan: CompleteScan,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const p of scan.processors) {
			await client.query(
				`insert into processors (address, issued, read_at_block) values ($1, $2, $3)
				 on conflict (address) do update set issued = excluded.issued, read_at_block = excluded.read_at_block`,
				[p.address, p.issued.toString(), scan.upToBlock.toString()],
			);
		}
		for (const t of scan.tapeOuts) {
			await client.query(
				`insert into circuits (processor, id, taped_out_block, taped_out_tx, taped_out_log, taped_out_by)
				 values ($1, $2, $3, $4, $5, $6)`,
				[
					t.circuit.processor,
					t.circuit.id.toString(),
					t.tapedOutAt.block.toString(),
					t.tapedOutAt.txIndex,
					t.tapedOutAt.logIndex,
					t.tapedOutBy,
				],
			);
		}
		await client.query(
			`insert into index_state (up_to_block) values ($1)
			 on conflict (only_row) do update set up_to_block = excluded.up_to_block`,
			[scan.upToBlock.toString()],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

export async function readIndex(pool: pg.Pool): Promise<StoredIndex> {
	const state = await pool.query<{ up_to_block: string }>(
		"select up_to_block from index_state",
	);
	const processors = await pool.query<{ address: string; issued: string }>(
		"select address, issued from processors order by address",
	);
	const circuits = await pool.query<{
		processor: string;
		id: string;
		taped_out_block: string;
		taped_out_tx: number;
		taped_out_log: number;
		taped_out_by: string;
	}>(
		`select processor, id, taped_out_block, taped_out_tx, taped_out_log, taped_out_by
		 from circuits order by taped_out_block, taped_out_tx, taped_out_log`,
	);
	const row = state.rows[0];
	return {
		upToBlock: row ? BigInt(row.up_to_block) : null,
		processors: processors.rows.map((p) => ({
			address: p.address as Address,
			issued: BigInt(p.issued),
		})),
		tapeOuts: circuits.rows.map((c) => ({
			circuit: { processor: c.processor as Address, id: BigInt(c.id) },
			tapedOutAt: {
				block: BigInt(c.taped_out_block),
				txIndex: c.taped_out_tx,
				logIndex: c.taped_out_log,
			},
			tapedOutBy: c.taped_out_by as Address,
		})),
	};
}
