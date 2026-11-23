// The circuit one RIG voucher names, for the Check box (docs/decisions/2026-11-22-check-box-input.md).
// RIG's `rigs(id)` gives the miner's processor and circuit id; a redeemed voucher and one never minted
// both give an empty record (22 Nov 2026), so both are "no circuit", never a made-up one. Read only.

import { type Address, type ChainRead, parseAddress } from "@foreman/contract";
import type { PublicClient } from "viem";
import { RIG_VOUCHER, rigVoucherAbi } from "./abi.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface VoucherCircuit {
	readAt: ChainRead;
	/** null when no live voucher has this number. */
	circuit: { processor: Address; id: bigint } | null;
}

export async function readVoucherCircuit(
	client: PublicClient,
	at: { voucherId: bigint; blockNumber: bigint },
): Promise<VoucherCircuit> {
	const [block, [processor, , id]] = await Promise.all([
		client.getBlock({ blockNumber: at.blockNumber }),
		client.readContract({
			address: RIG_VOUCHER,
			abi: rigVoucherAbi,
			functionName: "rigs",
			args: [at.voucherId],
			blockNumber: at.blockNumber,
		}),
	]);
	const readAt: ChainRead = {
		chainId: 196,
		block: block.number,
		time: block.timestamp,
	};
	if (processor.toLowerCase() === ZERO) return { readAt, circuit: null };
	return {
		readAt,
		circuit: {
			processor: parseAddress(processor.toLowerCase(), "RIG.rigs"),
			id,
		},
	};
}
