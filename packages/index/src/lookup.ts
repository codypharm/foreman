// The Check box's lookups in the stored index (docs/decisions/2026-11-22-check-box-input.md): a market
// listing number or a miner key to its circuit. A listing or key the index doesn't hold says so, with
// the block the index reached; nothing is guessed.

import { type Hex32, parseAddress } from "@foreman/contract";
import type { CircuitId } from "@foreman/originality";
import type pg from "pg";
import { marketRead } from "./market.ts";

export type ListingLookup =
	| { found: true; state: "open" | "sold"; circuit: CircuitId }
	/** Withdrawn: closed with no sale, and the index keeps no circuit for it. */
	| {
			found: false;
			reason: "withdrawn" | "no-such-listing";
			marketBlock: bigint;
	  };

/** An open listing's circuit, or a sold one's from its Sold event, at the block the market follow reached. */
export async function findListingCircuit(
	pool: pg.Pool,
	listingId: bigint,
): Promise<ListingLookup> {
	const at = await marketRead(pool);
	const { rows } = await pool.query<{
		open: boolean;
		processor: string | null;
		token_id: string | null;
		sold_processor: string | null;
		sold_token_id: string | null;
	}>(
		`select l.open, l.processor, l.token_id::text,
		   s.processor as sold_processor, s.token_id::text as sold_token_id
		 from market_listings l
		 left join lateral (
		   select processor, token_id from market_sales where listing_id = l.listing_id
		   order by block desc, log_index desc limit 1
		 ) s on true
		 where l.listing_id = $1`,
		[listingId.toString()],
	);
	const r = rows[0];
	if (!r)
		return { found: false, reason: "no-such-listing", marketBlock: at.block };
	if (r.open && r.processor && r.token_id) {
		return {
			found: true,
			state: "open",
			circuit: {
				processor: parseAddress(r.processor, "market_listings.processor"),
				id: BigInt(r.token_id),
			},
		};
	}
	if (r.sold_processor && r.sold_token_id) {
		return {
			found: true,
			state: "sold",
			circuit: {
				processor: parseAddress(r.sold_processor, "market_sales.processor"),
				id: BigInt(r.sold_token_id),
			},
		};
	}
	return { found: false, reason: "withdrawn", marketBlock: at.block };
}

export type MinerLookup =
	| { found: true; circuit: CircuitId }
	| {
			found: false;
			minersBlock: bigint;
			/** The X Layer block FabX's miners were read at, or null when FabX's aren't stored. */
			fabxMinersBlock: bigint | null;
	  };

/**
 * A miner key's circuit, from the miners the index has read up to its miners' block: TapeOut's on
 * BNB Chain, then FabX's on X Layer (2026-11-25-fabx-copy-check.md, decision 8).
 */
export async function findMinerCircuit(
	pool: pg.Pool,
	key: Hex32,
): Promise<MinerLookup> {
	const state = await pool.query<{ miners_up_to_block: string | null }>(
		"select miners_up_to_block::text from index_state",
	);
	const upTo = state.rows[0]?.miners_up_to_block;
	if (!upTo) {
		throw new Error(
			"The index's miners are not read yet: run the index follow",
		);
	}
	const fabxState = await pool.query<{ miners_read_at_block: string | null }>(
		"select miners_read_at_block::text from xlayer_state",
	);
	const fabxUpTo = fabxState.rows[0]?.miners_read_at_block ?? null;
	const { rows } = await pool.query<{ processor: string; id: string }>(
		`select processor, id::text from miners where key = decode($1, 'hex')
		 union all
		 select processor, id::text from fabx_miners where key = decode($1, 'hex')`,
		[key.slice(2).toLowerCase()],
	);
	// Keys are per mining contract: one key on both chains can't be told apart, so it isn't guessed
	if (rows.length > 1) {
		throw new Error(
			"That miner key is a miner on both BNB Chain and X Layer: paste the circuit instead",
		);
	}
	const r = rows[0];
	if (!r) {
		return {
			found: false,
			minersBlock: BigInt(upTo),
			fabxMinersBlock: fabxUpTo === null ? null : BigInt(fabxUpTo),
		};
	}
	return {
		found: true,
		circuit: {
			processor: parseAddress(r.processor, "miners.processor"),
			id: BigInt(r.id),
		},
	};
}
