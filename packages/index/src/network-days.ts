// Daily network samples (docs/decisions/2026-11-20-growth-rates.md, decision 4): the network at
// the first block at or after 00:00 UTC each day. The first fill loads the backfilled history; the
// follow adds each day after the last one saved, up to the last midnight before its block.

import { readNetworkHistory } from "@foreman/chain-bnb";
import type { NetworkState } from "@foreman/contract";
import type { DailySample } from "@foreman/valuation";
import type pg from "pg";
import type { PublicClient } from "viem";

const DAY = 86_400n;

/** Saves samples in one transaction. A day already saved with different figures is refused. */
export async function saveNetworkDays(
	pool: pg.Pool,
	samples: NetworkState[],
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const s of samples) {
			const day = s.readAt.time - (s.readAt.time % DAY);
			const values = [
				day.toString(),
				s.readAt.block.toString(),
				s.readAt.time.toString(),
				s.verifiedWeight.toString(),
				s.unverifiedWeight.toString(),
				s.minerCount.toString(),
				s.verifiedMinerCount.toString(),
			];
			const inserted = await client.query(
				`insert into network_days (day, block, time, verified_weight, unverified_weight,
				   miner_count, verified_miner_count)
				 values ($1, $2, $3, $4, $5, $6, $7) on conflict (day) do nothing`,
				values,
			);
			if (inserted.rowCount === 0) {
				const same = await client.query(
					`select 1 from network_days where day = $1 and block = $2 and time = $3
					   and verified_weight = $4 and unverified_weight = $5 and miner_count = $6
					   and verified_miner_count = $7`,
					values,
				);
				if (same.rowCount === 0) {
					throw new Error(
						`The index already holds a different network sample for day ${day}`,
					);
				}
			}
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/** Every saved day, oldest first, as the growth rule reads them. */
export async function readNetworkDays(pool: pg.Pool): Promise<DailySample[]> {
	const { rows } = await pool.query<{
		time: string;
		block: string;
		verified_weight: string;
	}>(
		`select time::text, block::text, verified_weight::text from network_days
		 order by network_days.day`,
	);
	return rows.map((r) => ({
		time: BigInt(r.time),
		block: BigInt(r.block),
		verifiedWeight: BigInt(r.verified_weight),
	}));
}

export type NetworkDaysFollowResult =
	| { followed: true; days: number }
	| { followed: false; detail: string };

/** Adds each day after the last one saved, up to the last midnight at or before `toBlock`. */
export async function followNetworkDays(
	pool: pg.Pool,
	client: PublicClient,
	options: { toBlock: bigint },
): Promise<NetworkDaysFollowResult> {
	const last = await pool.query<{ day: string | null }>(
		"select max(day)::text as day from network_days",
	);
	const lastDay = last.rows[0]?.day;
	if (lastDay == null) {
		return {
			followed: false,
			detail: "not filled yet: run the network's first fill",
		};
	}
	const block = await client.getBlock({ blockNumber: options.toBlock });
	const to = block.timestamp - (block.timestamp % DAY);
	const from = BigInt(lastDay) + DAY;
	if (from > to) return { followed: true, days: 0 };
	const samples = await readNetworkHistory(client, { from, to, every: DAY });
	await saveNetworkDays(pool, samples);
	return { followed: true, days: samples.length };
}
