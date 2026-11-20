// Fills the times of rows saved before migration 004 (docs/decisions/2026-11-20-originality-result.md,
// decision 1). Run once; until every time is filled, the loader refuses the index rather than
// show a blank date. A time is only ever a block's own timestamp, never worked out.

import { FACTORY_FIRST_BLOCK, LOG_SPAN, TAPED_OUT } from "@foreman/originality";
import type pg from "pg";
import {
	type Hex,
	hexToBigInt,
	hexToNumber,
	numberToHex,
	type PublicClient,
} from "viem";

export interface FillResult {
	filled: number;
	/** Rows still without a time: the loader keeps refusing until this is 0. */
	remaining: number;
	/** Why the fill stopped or skipped rows; null when nothing failed. */
	failed: string | null;
}

interface RawLog {
	address: string;
	topics: Hex[];
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
	blockTimestamp?: Hex;
}

/**
 * Reads TapedOut logs again, in the scan's own windows, for every window holding a tape-out
 * without a time, and fills each from its log's block time. A row is filled only when the log
 * matches it exactly: processor, id, block, transaction index and log index.
 */
export async function fillTapeOutTimes(
	pool: pg.Pool,
	client: PublicClient,
	onProgress?: (stage: string) => void,
): Promise<FillResult> {
	const state = await pool.query<{ up_to_block: string }>(
		"select up_to_block from index_state",
	);
	const row = state.rows[0];
	if (!row) throw new Error("the index is empty: save a tape-out scan first");
	const upTo = BigInt(row.up_to_block);
	const windows = await pool.query<{ w: string }>(
		`select distinct (taped_out_block - $1) / $2 as w from circuits
		 where taped_out_time is null order by w`,
		[FACTORY_FIRST_BLOCK.toString(), LOG_SPAN.toString()],
	);

	let filled = 0;
	let failed: string | null = null;
	for (const { w } of windows.rows) {
		const from = FACTORY_FIRST_BLOCK + BigInt(w) * LOG_SPAN;
		const to = from + LOG_SPAN - 1n < upTo ? from + LOG_SPAN - 1n : upTo;
		const stage = `TapedOut read, blocks ${from} to ${to}`;
		onProgress?.(stage);
		let logs: RawLog[];
		try {
			logs = (await client.request({
				method: "eth_getLogs",
				params: [
					{
						topics: [TAPED_OUT],
						fromBlock: numberToHex(from),
						toBlock: numberToHex(to),
					},
				],
			})) as RawLog[];
		} catch (error) {
			// viem's full message names the RPC URL, which can carry a key: keep only its short message
			const short =
				(error as { shortMessage?: string }).shortMessage ?? "read failed";
			failed = `${stage}: ${short}`;
			break;
		}
		const missing = logs.find((l) => !l.blockTimestamp);
		if (missing) {
			failed = `${stage}: the node returned no block time for block ${hexToBigInt(missing.blockNumber)}`;
			break;
		}
		const updated = await pool.query(
			`update circuits c set taped_out_time = l.time
			 from unnest($1::text[], $2::numeric[], $3::bigint[], $4::int[], $5::int[], $6::bigint[])
			   as l(processor, id, block, tx, log, time)
			 where c.processor = l.processor and c.id = l.id and c.taped_out_block = l.block
			   and c.taped_out_tx = l.tx and c.taped_out_log = l.log and c.taped_out_time is null`,
			[
				logs.map((l) => l.address.toLowerCase()),
				logs.map((l) => hexToBigInt(l.topics[1] as Hex).toString()),
				logs.map((l) => hexToBigInt(l.blockNumber).toString()),
				logs.map((l) => hexToNumber(l.transactionIndex)),
				logs.map((l) => hexToNumber(l.logIndex)),
				logs.map((l) => hexToBigInt(l.blockTimestamp as Hex).toString()),
			],
		);
		filled += updated.rowCount ?? 0;
	}
	const left = await pool.query<{ n: string }>(
		"select count(*) as n from circuits where taped_out_time is null",
	);
	return { filled, remaining: Number(left.rows[0]?.n ?? 0), failed };
}

/** Reads the block of every design commitment saved without a time, and fills it. */
export async function fillCommitmentTimes(
	pool: pg.Pool,
	client: PublicClient,
	options: {
		concurrency?: number;
		onProgress?: (done: number, total: number) => void;
	} = {},
): Promise<FillResult> {
	const blocks = await pool.query<{ block: string }>(
		`select distinct design_committed_at as block from miners
		 where design_committed_at is not null and design_committed_time is null
		 order by block`,
	);
	const all = blocks.rows.map((r) => BigInt(r.block));
	let filled = 0;
	const failures: string[] = [];
	const step = options.concurrency ?? 10;
	for (let i = 0; i < all.length; i += step) {
		const batch = all.slice(i, i + step);
		const reads = await Promise.all(
			batch.map(async (blockNumber) => {
				try {
					const b = await client.getBlock({ blockNumber });
					return { blockNumber, time: b.timestamp };
				} catch (error) {
					const short =
						(error as { shortMessage?: string }).shortMessage ?? "read failed";
					return { blockNumber, failed: `block ${blockNumber}: ${short}` };
				}
			}),
		);
		for (const r of reads) {
			if ("failed" in r) {
				failures.push(r.failed);
				continue;
			}
			const updated = await pool.query(
				`update miners set design_committed_time = $2
				 where design_committed_at = $1 and design_committed_time is null`,
				[r.blockNumber.toString(), r.time.toString()],
			);
			filled += updated.rowCount ?? 0;
		}
		options.onProgress?.(Math.min(i + step, all.length), all.length);
	}
	const left = await pool.query<{ n: string }>(
		`select count(*) as n from miners
		 where design_committed_at is not null and design_committed_time is null`,
	);
	return {
		filled,
		remaining: Number(left.rows[0]?.n ?? 0),
		failed:
			failures.length === 0
				? null
				: `${failures.length} block reads failed; first: ${failures[0]}`,
	};
}
