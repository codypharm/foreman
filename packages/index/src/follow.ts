// Keeps the index current (docs/decisions/2026-11-20-circuit-index.md, decision 5): brings every
// part of it from the block it was last read to up to `toBlock`, a finalized block. Each part
// follows from its own last block, so a follow stopped part-way is finished by the next one; until
// then the loader refuses the index (miners behind) or leaves new circuits out of the comparison
// (netlists unread). Read only on chain.

import {
	MINING_FIRST_BLOCK,
	scanMinerRevokes,
	scanMinerStarts,
	scanTapeOuts,
} from "@foreman/originality";
import type pg from "pg";
import type { Address, PublicClient } from "viem";
import { type BackfillResult, backfillNetlists } from "./backfill.ts";
import {
	backfillCommitments,
	type CommitmentBackfillResult,
	saveMinerRevokes,
	saveMinerStarts,
} from "./miners.ts";
import { saveScan } from "./store.ts";

export type FollowResult =
	| {
			followed: true;
			toBlock: bigint;
			/** New tape-outs saved. */
			tapeOuts: number;
			/** New miner starts saved, restarts included. */
			starts: number;
			/** New revokes saved. */
			revokes: number;
			commitments: CommitmentBackfillResult;
			netlists: BackfillResult;
	  }
	/** A scan that stopped: nothing from that part on is saved. */
	| {
			followed: false;
			stage: "tape-outs" | "miner-starts" | "revokes";
			detail: string;
	  };

export async function followIndex(
	pool: pg.Pool,
	client: PublicClient,
	options: { toBlock: bigint; onProgress?: (stage: string) => void },
): Promise<FollowResult> {
	const { toBlock, onProgress } = options;
	const state = await pool.query<{
		up_to_block: string;
		miners_up_to_block: string | null;
		revokes_up_to_block: string | null;
	}>(
		"select up_to_block, miners_up_to_block, revokes_up_to_block from index_state",
	);
	const row = state.rows[0];
	if (
		!row ||
		row.miners_up_to_block === null ||
		row.revokes_up_to_block === null
	) {
		throw new Error(
			"the index isn't built yet: run the tape-out scan, the miner scan and the revoke scan first",
		);
	}

	// Tape-outs: the count check adds the tape-outs already indexed
	let tapeOuts = 0;
	const tapeOutsFrom = BigInt(row.up_to_block) + 1n;
	if (tapeOutsFrom <= toBlock) {
		const counts = await pool.query<{ processor: string; n: string }>(
			"select processor, count(*) as n from circuits group by processor",
		);
		const indexed = new Map(
			counts.rows.map((r) => [r.processor as Address, Number(r.n)]),
		);
		const scan = await scanTapeOuts(
			client,
			{ fromBlock: tapeOutsFrom, toBlock },
			onProgress,
			indexed,
		);
		if (!scan.complete) {
			return { followed: false, stage: "tape-outs", detail: scan.detail };
		}
		await saveScan(pool, scan);
		tapeOuts = scan.tapeOuts.length;
	}

	// Miner starts, then revokes: no miner started before the mining contract existed
	const from = (upTo: string) => {
		const next = BigInt(upTo) + 1n;
		return next > MINING_FIRST_BLOCK ? next : MINING_FIRST_BLOCK;
	};
	let starts = 0;
	if (BigInt(row.miners_up_to_block) < toBlock) {
		const fromBlock = from(row.miners_up_to_block);
		const scan =
			fromBlock <= toBlock
				? await scanMinerStarts(client, { fromBlock, toBlock }, onProgress)
				: { complete: true as const, upToBlock: toBlock, starts: [] };
		if (!scan.complete) {
			return { followed: false, stage: "miner-starts", detail: scan.detail };
		}
		await saveMinerStarts(pool, scan);
		starts = scan.starts.length;
	}
	let revokes = 0;
	if (BigInt(row.revokes_up_to_block) < toBlock) {
		const fromBlock = from(row.revokes_up_to_block);
		const scan =
			fromBlock <= toBlock
				? await scanMinerRevokes(client, { fromBlock, toBlock }, onProgress)
				: { complete: true as const, upToBlock: toBlock, revokes: [] };
		if (!scan.complete) {
			return { followed: false, stage: "revokes", detail: scan.detail };
		}
		await saveMinerRevokes(pool, scan);
		revokes = scan.revokes.length;
	}

	// Commitments of new and restarted miners, then new netlists, read at the index's block
	const commitments = await backfillCommitments(pool, client);
	const netlists = await backfillNetlists(pool, client);
	return {
		followed: true,
		toBlock,
		tapeOuts,
		starts,
		revokes,
		commitments,
		netlists,
	};
}
