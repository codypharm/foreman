// What the publish job has written to a results contract on X Layer
// (docs/decisions/2026-11-21-publish-job.md, decision 2). Rows are recorded only after their
// transaction confirms. The job checks them against the contract's resultOf before each send.

import {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import type pg from "pg";

/** A deployed ForemanResults contract: X Layer mainnet (196) or testnet (1952). */
export interface ResultsContract {
	chainId: 196 | 1952;
	address: Address;
}

/** One circuit's entry as published: the contract's short verdict and the job's fingerprint. */
export interface PublishedEntry {
	key: Hex32;
	processor: Address;
	id: bigint;
	/** 1 no earlier copy found, 2 copy, 3 too small to tell, 4 wrapper, 5 can't check. */
	kind: number;
	/** 1 mining, 2 can't mine, 3 stopped, 4 not started. */
	canMine: number;
	fingerprint: Hex32;
	resultHash: Hex32;
	indexBlock: bigint;
}

export type PublishedRow = PublishedEntry & { tx: Hex32; block: bigint };

interface PublishedColumns {
	key: Buffer;
	processor: string;
	id: string;
	kind: number;
	can_mine: number;
	fingerprint: Buffer;
	result_hash: Buffer;
	index_block: string;
	tx: string;
	block: string;
}

const SELECT_PUBLISHED = `select key, processor, id, kind, can_mine, fingerprint, result_hash,
  index_block, tx, block from published_results where chain_id = $1 and contract = $2`;

/** Every circuit published to this contract, by key. */
export async function readPublished(
	pool: pg.Pool,
	contract: ResultsContract,
): Promise<Map<Hex32, PublishedRow>> {
	const rows = await pool.query<PublishedColumns>(SELECT_PUBLISHED, [
		contract.chainId,
		contract.address.toLowerCase(),
	]);
	return new Map(
		rows.rows.map((r) => {
			const row = publishedRow(r);
			return [row.key, row];
		}),
	);
}

/** One circuit's row, by its miner key; null when it was never published to this contract. */
export async function readPublishedRow(
	pool: pg.Pool,
	contract: ResultsContract,
	key: Hex32,
): Promise<PublishedRow | null> {
	const rows = await pool.query<PublishedColumns>(
		`${SELECT_PUBLISHED} and key = $3`,
		[
			contract.chainId,
			contract.address.toLowerCase(),
			Buffer.from(key.slice(2), "hex"),
		],
	);
	const r = rows.rows[0];
	return r ? publishedRow(r) : null;
}

function publishedRow(r: PublishedColumns): PublishedRow {
	const hex = (b: Buffer, field: string) =>
		parseHex32(`0x${b.toString("hex")}`, field);
	return {
		key: hex(r.key, "published_results.key"),
		processor: parseAddress(r.processor, "published_results.processor"),
		id: BigInt(r.id),
		kind: r.kind,
		canMine: r.can_mine,
		fingerprint: hex(r.fingerprint, "published_results.fingerprint"),
		resultHash: hex(r.result_hash, "published_results.result_hash"),
		indexBlock: BigInt(r.index_block),
		tx: parseHex32(r.tx, "published_results.tx"),
		block: BigInt(r.block),
	};
}

/** Records one confirmed batch in one database transaction; a republish replaces the row. */
export async function recordPublished(
	pool: pg.Pool,
	contract: ResultsContract,
	entries: PublishedEntry[],
	at: { tx: Hex32; block: bigint },
): Promise<void> {
	const bytes = (h: Hex32) => Buffer.from(h.slice(2), "hex");
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const e of entries) {
			await client.query(
				`insert into published_results (chain_id, contract, key, processor, id, kind, can_mine,
				   fingerprint, result_hash, index_block, tx, block)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				 on conflict (chain_id, contract, key) do update set
				   processor = excluded.processor, id = excluded.id, kind = excluded.kind,
				   can_mine = excluded.can_mine, fingerprint = excluded.fingerprint,
				   result_hash = excluded.result_hash, index_block = excluded.index_block,
				   tx = excluded.tx, block = excluded.block`,
				[
					contract.chainId,
					contract.address.toLowerCase(),
					bytes(e.key),
					e.processor.toLowerCase(),
					e.id.toString(),
					e.kind,
					e.canMine,
					bytes(e.fingerprint),
					bytes(e.resultHash),
					e.indexBlock.toString(),
					at.tx.toLowerCase(),
					at.block.toString(),
				],
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
