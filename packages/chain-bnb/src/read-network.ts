// Reads the mining contract's totals at one block into the contract's NetworkState.
// Network weight is the denominator of every valuation, so it is never read without its block.

import {
	type NetworkState,
	parseNetworkState,
	serialiseNetworkState,
} from "@foreman/contract";
import type { PublicClient } from "viem";
import { POD_MINING, podMiningAbi } from "./abi.ts";

export async function readNetworkState(
	client: PublicClient,
	at: { blockNumber: bigint },
): Promise<NetworkState> {
	const { blockNumber } = at;
	const read = (
		functionName:
			| "totalVerifWeight"
			| "totalUnverWeight"
			| "minerCount"
			| "verifMinerCount",
	) =>
		client.readContract({
			address: POD_MINING,
			abi: podMiningAbi,
			functionName,
			blockNumber,
		});
	const [
		block,
		verifiedWeight,
		unverifiedWeight,
		minerCount,
		verifiedMinerCount,
	] = await Promise.all([
		client.getBlock({ blockNumber }),
		read("totalVerifWeight"),
		read("totalUnverWeight"),
		read("minerCount"),
		read("verifMinerCount"),
	]);
	const network: NetworkState = {
		verifiedWeight,
		unverifiedWeight,
		minerCount,
		verifiedMinerCount,
		readAt: { chainId: 56, block: block.number, time: block.timestamp },
	};
	return parseNetworkState(
		serialiseNetworkState(network, "network"),
		"network",
	);
}
