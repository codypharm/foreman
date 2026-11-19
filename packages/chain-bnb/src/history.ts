// Network history: NetworkState sampled at fixed times, for the valuation's growth rates
// and the backtests. Sampling is by time, not by block count, because BNB Chain's block
// time has changed before. Reading state at old blocks needs an archive node.

import type { NetworkState } from "@foreman/contract";
import type { PublicClient } from "viem";
import { ChainReadError } from "./errors.ts";
import { readNetworkState } from "./read-network.ts";

/**
 * The first block whose timestamp is at or after `time` (Unix seconds): step back from the
 * latest block in doubling steps, then binary search. `after`, a block earlier than `time`,
 * replaces the stepping back.
 */
export async function blockAtOrAfter(
	client: PublicClient,
	time: bigint,
	options: { after?: bigint } = {},
): Promise<bigint> {
	const timeOf = async (blockNumber: bigint) =>
		(await client.getBlock({ blockNumber })).timestamp;

	let hi = await client.getBlockNumber();
	if ((await timeOf(hi)) < time) {
		throw new ChainReadError(
			`No block yet at ${time}: the latest is block ${hi}`,
		);
	}
	let lo: bigint;
	if (options.after !== undefined && (await timeOf(options.after)) < time) {
		lo = options.after;
	} else {
		// Step back from the head in doubling steps until a block is earlier than `time`.
		// Recent times stay near the head, which non-archive nodes still serve.
		let step = 1024n;
		lo = hi > step ? hi - step : 0n;
		while ((await timeOf(lo)) >= time) {
			if (lo === 0n) return 0n;
			hi = lo;
			step *= 2n;
			lo = hi > step ? hi - step : 0n;
		}
	}
	// Invariant: timeOf(lo) < time <= timeOf(hi)
	while (hi - lo > 1n) {
		const mid = lo + (hi - lo) / 2n;
		if ((await timeOf(mid)) >= time) hi = mid;
		else lo = mid;
	}
	return hi;
}

/**
 * NetworkState at `from`, `from + every`, … up to `to` (Unix seconds, inclusive), each read
 * at the first block at or after its time. Sequential, to stay inside public RPC limits.
 */
export async function readNetworkHistory(
	client: PublicClient,
	window: { from: bigint; to: bigint; every: bigint },
): Promise<NetworkState[]> {
	const { from, to, every } = window;
	if (every <= 0n)
		throw new RangeError(`every must be above 0 seconds, got ${every}`);
	if (to < from) throw new RangeError(`to (${to}) is before from (${from})`);

	const history: NetworkState[] = [];
	let after: bigint | undefined;
	for (let time = from; time <= to; time += every) {
		const blockNumber = await blockAtOrAfter(
			client,
			time,
			after === undefined ? {} : { after },
		);
		history.push(await readNetworkState(client, { blockNumber }));
		after = blockNumber;
	}
	return history;
}
