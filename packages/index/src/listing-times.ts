// The one-off fill of listing times (migration 009) for listings the market index held before the
// follow started keeping them: each listing's Listed event, from the market's first block to the
// block the market is indexed up to. Every listing gets its time, or nothing is saved. Read only on
// chain; needs the archive node, which it trusts only because the Listed count must match.

import {
	CIRCUIT_MARKET_FIRST_BLOCK,
	readMarketEvents,
} from "@foreman/chain-bnb";
import type pg from "pg";
import type { PublicClient } from "viem";

export type ListingTimesResult =
	| { filled: true; listings: number }
	| { filled: false; detail: string };

export async function fillListingTimes(
	pool: pg.Pool,
	client: PublicClient,
): Promise<ListingTimesResult> {
	const state = await pool.query<{ market_up_to_block: string | null }>(
		"select market_up_to_block::text from index_state",
	);
	const upTo = state.rows[0]?.market_up_to_block;
	if (!upTo) {
		return { filled: false, detail: "the market index is not filled yet" };
	}
	const count = await pool.query<{ n: number }>(
		"select count(*)::int as n from market_listings",
	);
	const listings = count.rows[0]?.n ?? 0;

	let listed: { listingId: bigint; block: bigint; time: bigint }[];
	try {
		const events = await readMarketEvents(client, {
			fromBlock: CIRCUIT_MARKET_FIRST_BLOCK,
			toBlock: BigInt(upTo),
		});
		listed = events.flatMap((e) =>
			e.event === "listed"
				? [{ listingId: e.listingId, block: e.at.block, time: e.at.time }]
				: [],
		);
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ??
			(error as Error).message ??
			"read failed";
		return {
			filled: false,
			detail: `market events to block ${upTo}: ${short}`,
		};
	}
	// An empty or short read (a node without history) can't pass this
	if (listed.length !== listings) {
		return {
			filled: false,
			detail: `${listed.length} Listed events to block ${upTo}, but the index holds ${listings} listings`,
		};
	}

	const db = await pool.connect();
	try {
		await db.query("begin");
		const updated = await db.query(
			`update market_listings m set listed_block = v.block, listed_time = v.time
			 from unnest($1::numeric[], $2::bigint[], $3::bigint[]) as v(id, block, time)
			 where m.listing_id = v.id`,
			[
				listed.map((l) => l.listingId.toString()),
				listed.map((l) => l.block.toString()),
				listed.map((l) => l.time.toString()),
			],
		);
		if (updated.rowCount !== listings) {
			await db.query("rollback");
			return {
				filled: false,
				detail: `the Listed events matched ${updated.rowCount} of the index's ${listings} listings`,
			};
		}
		await db.query("commit");
	} catch (error) {
		await db.query("rollback");
		throw error;
	} finally {
		db.release();
	}
	return { filled: true, listings };
}
