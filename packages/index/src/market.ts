// The market index's storage (docs/decisions/2026-11-20-market-index.md): every sale on TapeOut's
// circuit market with its miner's state at the block before, and every listing ever made, the open
// ones with their miner and whether they can be bought. A follow saves one complete market scan in
// one transaction, or nothing.

import {
	CIRCUIT_MARKET_FIRST_BLOCK,
	type MarketListing,
	type MarketScan,
	scanMarket,
} from "@foreman/chain-bnb";
import { parseAddress } from "@foreman/contract";
import { SALES_WINDOW_SECONDS } from "@foreman/valuation";
import type pg from "pg";
import type { PublicClient } from "viem";

export interface MarketBook {
	/** null before the first fill. */
	upToBlock: bigint | null;
	/** Listing ids the index holds, open or closed. */
	listingsIndexed: bigint;
	open: MarketListing[];
}

export async function readMarketBook(pool: pg.Pool): Promise<MarketBook> {
	const [state, count, open] = await Promise.all([
		pool.query<{ market_up_to_block: string | null }>(
			"select market_up_to_block from index_state",
		),
		pool.query<{ n: string }>("select count(*) as n from market_listings"),
		pool.query<{
			listing_id: string;
			seller: string;
			processor: string;
			token_id: string;
			price_wei: string;
			fee_bps: number;
		}>(
			`select listing_id, seller, processor, token_id, price_wei, fee_bps
			 from market_listings where open order by listing_id`,
		),
	]);
	const upTo = state.rows[0]?.market_up_to_block ?? null;
	return {
		upToBlock: upTo === null ? null : BigInt(upTo),
		listingsIndexed: BigInt(count.rows[0]?.n ?? 0),
		open: open.rows.map((r) => ({
			listingId: BigInt(r.listing_id),
			seller: parseAddress(r.seller, "market_listings.seller"),
			processor: parseAddress(r.processor, "market_listings.processor"),
			tokenId: BigInt(r.token_id),
			priceWei: BigInt(r.price_wei),
			feeBps: r.fee_bps,
		})),
	};
}

export type MarketFollowResult =
	| {
			followed: true;
			toBlock: bigint;
			sales: number;
			listings: number;
			open: number;
	  }
	| { followed: false; detail: string };

/**
 * Brings the market index from its last block (or the market's first block, for the first fill)
 * up to `toBlock`, a finalized block. Needs the archive node.
 */
export async function followMarket(
	pool: pg.Pool,
	client: PublicClient,
	options: { toBlock: bigint; concurrency?: number },
): Promise<MarketFollowResult> {
	const book = await readMarketBook(pool);
	const fromBlock =
		book.upToBlock === null ? CIRCUIT_MARKET_FIRST_BLOCK : book.upToBlock + 1n;
	if (fromBlock > options.toBlock) {
		return {
			followed: true,
			toBlock: options.toBlock,
			sales: 0,
			listings: 0,
			open: book.open.length,
		};
	}
	const scan = await scanMarket(client, {
		fromBlock,
		toBlock: options.toBlock,
		listingsIndexed: book.listingsIndexed,
		open: book.open,
		stateWindowSeconds: SALES_WINDOW_SECONDS,
		...(options.concurrency === undefined
			? {}
			: { concurrency: options.concurrency }),
	});
	if (!scan.complete) return { followed: false, detail: scan.detail };
	await saveMarketScan(pool, scan);
	return {
		followed: true,
		toBlock: scan.upToBlock,
		sales: scan.sales.length,
		listings: scan.listings.length,
		open: scan.states.length,
	};
}

async function saveMarketScan(
	pool: pg.Pool,
	scan: Extract<MarketScan, { complete: true }>,
): Promise<void> {
	const block = scan.upToBlock.toString();
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const { sale, miner } of scan.sales) {
			await client.query(
				`insert into market_sales (block, log_index, tx, time, listing_id, processor, token_id,
				   buyer, price_wei, fee_wei, miner_status, miner_task_id, miner_verif_weight, miner_unver_weight)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
				[
					sale.at.block.toString(),
					sale.at.logIndex,
					sale.at.tx,
					sale.at.time.toString(),
					sale.listingId.toString(),
					sale.processor,
					sale.tokenId.toString(),
					sale.buyer,
					sale.priceWei.toString(),
					sale.feeWei.toString(),
					miner?.status ?? null,
					miner?.taskId ?? null,
					miner?.verifWeight.toString() ?? null,
					miner?.unverWeight.toString() ?? null,
				],
			);
		}
		for (const { listingId, listing } of scan.listings) {
			await client.query(
				`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id, price_wei, fee_bps)
				 values ($1, $2, $3, $4, $5, $6, $7, $8)
				 on conflict (listing_id) do update set read_at_block = excluded.read_at_block,
				   open = excluded.open, seller = excluded.seller, processor = excluded.processor,
				   token_id = excluded.token_id, price_wei = excluded.price_wei, fee_bps = excluded.fee_bps,
				   state_read_at_block = null, buyable = null, miner_status = null, miner_task_id = null,
				   miner_verif_weight = null, miner_unver_weight = null`,
				[
					listingId.toString(),
					block,
					listing !== null,
					listing?.seller ?? null,
					listing?.processor ?? null,
					listing?.tokenId.toString() ?? null,
					listing?.priceWei.toString() ?? null,
					listing?.feeBps ?? null,
				],
			);
		}
		for (const s of scan.states) {
			const updated = await client.query(
				`update market_listings set state_read_at_block = $2, buyable = $3, miner_status = $4,
				   miner_task_id = $5, miner_verif_weight = $6, miner_unver_weight = $7
				 where listing_id = $1 and open`,
				[
					s.listingId.toString(),
					block,
					s.buyable,
					s.miner.status,
					s.miner.taskId,
					s.miner.verifWeight.toString(),
					s.miner.unverWeight.toString(),
				],
			);
			if (updated.rowCount !== 1) {
				throw new Error(
					`State for listing ${s.listingId}, which the index doesn't hold as open`,
				);
			}
		}
		// Every open listing has its state from this block, or the scan was incomplete
		const stale = await client.query<{ listing_id: string }>(
			`select listing_id from market_listings
			 where open and (state_read_at_block is distinct from $1) limit 3`,
			[block],
		);
		if (stale.rows.length > 0) {
			throw new Error(
				`Open listings without a state at block ${block}: ${stale.rows.map((r) => r.listing_id).join(", ")}`,
			);
		}
		const count = await client.query<{ n: string }>(
			"select count(*) as n from market_listings",
		);
		if (BigInt(count.rows[0]?.n ?? 0) !== scan.listingsIssued) {
			throw new Error(
				`The index holds ${count.rows[0]?.n} listings, but nextListingId is ${scan.listingsIssued} at block ${block}`,
			);
		}
		await client.query(
			"update index_state set market_up_to_block = $1, market_up_to_time = $2",
			[block, scan.upToTime.toString()],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}
