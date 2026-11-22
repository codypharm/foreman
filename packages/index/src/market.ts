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
import {
	type BnbRead,
	type ListingAsk,
	type NetworkState,
	parseAddress,
	parseHex32,
	parseNetworkState,
} from "@foreman/contract";
import type { CircuitId } from "@foreman/originality";
import {
	type MarketMinerState,
	SALES_WINDOW_SECONDS,
	type SellMarket,
} from "@foreman/valuation";
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

/**
 * A circuit's open listing on TapeOut's BNB market, as the market index holds it at the block the
 * follow reached. With more than one open, the newest that can be bought, else the newest.
 */
export async function readCircuitListing(
	pool: pg.Pool,
	circuit: CircuitId,
): Promise<ListingAsk | null> {
	const at = await marketRead(pool);
	const { rows } = await pool.query<{
		listing_id: string;
		seller: string;
		price_wei: string;
		listed_block: string | null;
		listed_time: string | null;
		buyable: boolean | null;
	}>(
		`select listing_id::text, seller, price_wei::text, listed_block::text, listed_time::text, buyable
		 from market_listings where open and processor = $1 and token_id = $2
		 order by buyable desc nulls last, listed_block desc, listing_id desc limit 1`,
		[circuit.processor.toLowerCase(), circuit.id.toString()],
	);
	const r = rows[0];
	if (!r) return null;
	if (r.buyable === null || r.listed_block === null || r.listed_time === null) {
		throw new Error(
			`The index hasn't read listing ${r.listing_id}'s state or listing time yet`,
		);
	}
	return {
		listingId: BigInt(r.listing_id),
		seller: parseAddress(r.seller, "market_listings.seller"),
		ask: { currency: "BNB", value: BigInt(r.price_wei) },
		listedAt: { block: BigInt(r.listed_block), time: BigInt(r.listed_time) },
		buyable: r.buyable,
		readAt: at,
	};
}

/** A listing's miner as stored at the market's block: the getMiner fields a value needs. */
export interface StoredListingMiner {
	/** 0 not mining, 1 active, 2 revoked, 3 cooling (getMiner's status). */
	status: number;
	/** 0 is the unverified pool. */
	taskId: number;
	verifWeight: bigint;
	unverWeight: bigint;
	weightWithoutBonus: bigint;
	readAt: BnbRead;
}

export interface OpenListing {
	ask: ListingAsk;
	circuit: CircuitId;
	/** Null when the follow hasn't read this listing's miner at the market's block. */
	miner: StoredListingMiner | null;
	/** The stored result's verdict, null when the circuit has none yet. */
	kind: string | null;
}

/**
 * Every open listing on TapeOut's BNB market as the follow last read it, newest listed first, with
 * its miner's stored state and its circuit's stored verdict: the listings page, with no live read.
 */
export async function readOpenListings(pool: pg.Pool): Promise<OpenListing[]> {
	const at = await marketRead(pool);
	const { rows } = await pool.query<{
		listing_id: string;
		seller: string;
		processor: string;
		token_id: string;
		price_wei: string;
		listed_block: string | null;
		listed_time: string | null;
		buyable: boolean | null;
		state_read_at_block: string | null;
		miner_status: number | null;
		miner_task_id: number | null;
		miner_verif_weight: string | null;
		miner_unver_weight: string | null;
		miner_weight_without_bonus: string | null;
		kind: string | null;
	}>(
		`select l.listing_id::text, l.seller, l.processor, l.token_id::text, l.price_wei::text,
		   l.listed_block::text, l.listed_time::text, l.buyable, l.state_read_at_block::text,
		   l.miner_status, l.miner_task_id, l.miner_verif_weight::text, l.miner_unver_weight::text,
		   l.miner_weight_without_bonus::text, r.kind
		 from market_listings l
		 left join circuit_results r on r.processor = l.processor and r.id = l.token_id
		 where l.open
		 order by l.listed_block desc nulls last, l.listing_id desc`,
	);
	return rows.map((r) => {
		if (
			r.buyable === null ||
			r.listed_block === null ||
			r.listed_time === null
		) {
			throw new Error(
				`The index hasn't read listing ${r.listing_id}'s state or listing time yet`,
			);
		}
		const stateHere =
			r.state_read_at_block !== null &&
			BigInt(r.state_read_at_block) === at.block &&
			r.miner_status !== null &&
			r.miner_task_id !== null &&
			r.miner_verif_weight !== null &&
			r.miner_unver_weight !== null &&
			r.miner_weight_without_bonus !== null;
		return {
			ask: {
				listingId: BigInt(r.listing_id),
				seller: parseAddress(r.seller, "market_listings.seller"),
				ask: { currency: "BNB", value: BigInt(r.price_wei) },
				listedAt: {
					block: BigInt(r.listed_block),
					time: BigInt(r.listed_time),
				},
				buyable: r.buyable,
				readAt: at,
			},
			circuit: {
				processor: parseAddress(r.processor, "market_listings.processor"),
				id: BigInt(r.token_id),
			},
			miner: stateHere
				? {
						status: r.miner_status as number,
						taskId: r.miner_task_id as number,
						verifWeight: BigInt(r.miner_verif_weight as string),
						unverWeight: BigInt(r.miner_unver_weight as string),
						weightWithoutBonus: BigInt(r.miner_weight_without_bonus as string),
						readAt: at,
					}
				: null,
			kind: r.kind,
		};
	});
}

/** The block and time the market follow reached; refuses before its first fill. */
export async function marketRead(pool: pg.Pool): Promise<BnbRead> {
	const state = await pool.query<{
		market_up_to_block: string | null;
		market_up_to_time: string | null;
	}>("select market_up_to_block, market_up_to_time from index_state");
	const row = state.rows[0];
	if (!row?.market_up_to_block || !row.market_up_to_time) {
		throw new Error(
			"The market index is not filled yet: run the market's first fill",
		);
	}
	return {
		chainId: 56,
		block: BigInt(row.market_up_to_block),
		time: BigInt(row.market_up_to_time),
	};
}

/**
 * The network at the market's block, stored by the market follow with its listings, or null before
 * the first follow that stored it (docs/decisions/2026-11-22-market-network.md).
 */
export async function readMarketNetwork(
	pool: pg.Pool,
): Promise<NetworkState | null> {
	const { rows } = await pool.query<{
		market_up_to_block: string | null;
		market_up_to_time: string | null;
		market_verified_weight: string | null;
		market_unverified_weight: string | null;
		market_miner_count: string | null;
		market_verified_miner_count: string | null;
	}>(
		`select market_up_to_block, market_up_to_time, market_verified_weight, market_unverified_weight,
		   market_miner_count, market_verified_miner_count from index_state`,
	);
	const r = rows[0];
	if (
		!r?.market_up_to_block ||
		!r.market_up_to_time ||
		r.market_verified_weight === null ||
		r.market_unverified_weight === null ||
		r.market_miner_count === null ||
		r.market_verified_miner_count === null
	) {
		return null;
	}
	return parseNetworkState(
		{
			verifiedWeight: r.market_verified_weight,
			unverifiedWeight: r.market_unverified_weight,
			minerCount: r.market_miner_count,
			verifiedMinerCount: r.market_verified_miner_count,
			readAt: {
				chainId: 56,
				block: r.market_up_to_block,
				time: r.market_up_to_time,
			},
		},
		"market network",
	);
}

interface MinerColumns {
	miner_status: number;
	miner_task_id: number;
	miner_verif_weight: string;
	miner_unver_weight: string;
}

/**
 * What the Sell rule reads (docs/decisions/2026-11-20-sell-comparables.md), at the block the market
 * is indexed up to: the sales of the last 14 days, each with its miner at the block before, and the
 * open listings that can be bought now, with their miners at that block.
 */
export async function readSellMarket(pool: pg.Pool): Promise<SellMarket> {
	const at = await marketRead(pool);
	const [sales, asks] = await Promise.all([
		pool.query<
			{
				block: string;
				time: string;
				tx: string;
				price_wei: string;
			} & MinerColumns
		>(
			`select block::text, time::text, tx, price_wei::text, miner_status, miner_task_id,
			   miner_verif_weight::text, miner_unver_weight::text
			 from market_sales where time >= $1 order by market_sales.block, market_sales.log_index`,
			[(at.time - SALES_WINDOW_SECONDS).toString()],
		),
		pool.query<{ listing_id: string; price_wei: string } & MinerColumns>(
			`select listing_id::text, price_wei::text, miner_status, miner_task_id,
			   miner_verif_weight::text, miner_unver_weight::text
			 from market_listings where open and buyable order by market_listings.listing_id`,
		),
	]);
	return {
		at,
		sales: sales.rows.map((r) => ({
			priceWei: BigInt(r.price_wei),
			readAt: { chainId: 56, block: BigInt(r.block), time: BigInt(r.time) },
			tx: parseHex32(r.tx, "market_sales.tx"),
			miner: minerState(r, `the sale at block ${r.block}`),
		})),
		asks: asks.rows.map((r) => ({
			priceWei: BigInt(r.price_wei),
			readAt: at,
			miner: minerState(r, `listing ${r.listing_id}`),
		})),
	};
}

/** Mining is status 1 (active); task 0 is the unverified pool, and its weight is unverWeight. */
function minerState(r: MinerColumns, what: string): MarketMinerState {
	if (r.miner_status === null) {
		throw new Error(`The index holds no miner state for ${what}`);
	}
	if (r.miner_status !== 1) return { mining: false };
	const pool = r.miner_task_id === 0 ? "unverified" : "verified";
	const weight = BigInt(
		pool === "verified" ? r.miner_verif_weight : r.miner_unver_weight,
	);
	if (weight === 0n) {
		throw new Error(
			`The miner for ${what} is mining with no weight in its pool`,
		);
	}
	return { mining: true, pool, weight };
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
	options: {
		toBlock: bigint;
		concurrency?: number;
		catchUpTo?: () => Promise<bigint>;
	},
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
		...(options.catchUpTo ? { catchUpTo: options.catchUpTo } : {}),
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
				   miner_verif_weight = null, miner_unver_weight = null, miner_weight_without_bonus = null`,
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
		for (const l of scan.listed) {
			const updated = await client.query(
				"update market_listings set listed_block = $2, listed_time = $3 where listing_id = $1",
				[l.listingId.toString(), l.block.toString(), l.time.toString()],
			);
			if (updated.rowCount !== 1) {
				throw new Error(
					`A Listed event for listing ${l.listingId}, which the scan didn't read`,
				);
			}
		}
		for (const s of scan.states) {
			const updated = await client.query(
				`update market_listings set state_read_at_block = $2, buyable = $3, miner_status = $4,
				   miner_task_id = $5, miner_verif_weight = $6, miner_unver_weight = $7,
				   miner_weight_without_bonus = $8
				 where listing_id = $1 and open`,
				[
					s.listingId.toString(),
					block,
					s.buyable,
					s.miner.status,
					s.miner.taskId,
					s.miner.verifWeight.toString(),
					s.miner.unverWeight.toString(),
					s.miner.weightWithoutBonus.toString(),
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
			`update index_state set market_up_to_block = $1, market_up_to_time = $2,
			   market_verified_weight = $3, market_unverified_weight = $4,
			   market_miner_count = $5, market_verified_miner_count = $6`,
			[
				block,
				scan.upToTime.toString(),
				scan.network.verifiedWeight.toString(),
				scan.network.unverifiedWeight.toString(),
				scan.network.minerCount.toString(),
				scan.network.verifiedMinerCount.toString(),
			],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}
