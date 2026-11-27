// A processor by its place in TapeOut's BNB Chain processor factory, the number TapeOut's market shows
// after a circuit's id ("13931.30" is circuit 13931 on processor #30;
// docs/decisions/2026-11-27-tapeout-circuit-label.md). Read at one block: the factory's count, then
// cpuAt. A place past the count is no processor, never a guess.

import type { Address } from "@foreman/contract";
import { parseAddress } from "@foreman/contract";
import type { PublicClient } from "viem";

/** TapeOut's processor factory on BNB Chain. In CLAUDE.md "On-chain facts" (20 Nov 2026). */
export const PROCESSOR_FACTORY =
	"0x68224f668083c29e9800be2a646d42d18cedf7e2" as const;

const factoryAbi = [
	{
		name: "cpuCount",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "cpuAt",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "i", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
	},
] as const;

export type ProcessorAtRead =
	| { found: true; processor: Address; blockNumber: bigint }
	| { found: false; count: bigint; blockNumber: bigint };

export async function readProcessorAt(
	client: PublicClient,
	{ position, blockNumber }: { position: bigint; blockNumber: bigint },
): Promise<ProcessorAtRead> {
	const count = await client.readContract({
		address: PROCESSOR_FACTORY,
		abi: factoryAbi,
		functionName: "cpuCount",
		blockNumber,
	});
	if (position >= count) return { found: false, count, blockNumber };
	const processor = await client.readContract({
		address: PROCESSOR_FACTORY,
		abi: factoryAbi,
		functionName: "cpuAt",
		args: [position],
		blockNumber,
	});
	return {
		found: true,
		processor: parseAddress(processor.toLowerCase(), "cpuAt"),
		blockNumber,
	};
}
