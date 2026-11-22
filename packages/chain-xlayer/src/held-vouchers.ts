// The RIG vouchers one wallet holds on X Layer, each with the miner it stands for
// (docs/decisions/2026-11-22-wallet-miners.md). RIG is ERC-721 enumerable (supportsInterface
// 0x780e9d63 was true on 22 Nov 2026), so this reads the wallet's own vouchers, not all of them.
// Read only. Any failed read rejects: a wallet whose vouchers couldn't be read never shows none.

import { type Address, type ChainRead, parseAddress } from "@foreman/contract";
import type { PublicClient } from "viem";
import { RIG_VOUCHER, rigVoucherAbi } from "./abi.ts";
import { VOUCHER_READS_AT_ONCE } from "./lend.ts";

export interface HeldVoucher {
	voucherId: bigint;
	/** The miner's circuit on BNB Chain, from RIG's `rigs(id)`. */
	circuit: { processor: Address; id: bigint };
}

export interface HeldVouchers {
	readAt: ChainRead;
	/** In the order RIG lists them for the wallet. */
	vouchers: HeldVoucher[];
}

export async function readHeldVouchers(
	client: PublicClient,
	at: { holder: Address; blockNumber: bigint },
): Promise<HeldVouchers> {
	const rig = {
		address: RIG_VOUCHER,
		abi: rigVoucherAbi,
		blockNumber: at.blockNumber,
	} as const;
	const [block, count] = await Promise.all([
		client.getBlock({ blockNumber: at.blockNumber }),
		client.readContract({
			...rig,
			functionName: "balanceOf",
			args: [at.holder],
		}),
	]);
	const vouchers: HeldVoucher[] = [];
	let next = 0n;
	const worker = async () => {
		while (next < count) {
			const i = next++;
			const voucherId = await client.readContract({
				...rig,
				functionName: "tokenOfOwnerByIndex",
				args: [at.holder, i],
			});
			const [processor, , id] = await client.readContract({
				...rig,
				functionName: "rigs",
				args: [voucherId],
			});
			vouchers[Number(i)] = {
				voucherId,
				circuit: {
					processor: parseAddress(processor.toLowerCase(), "RIG.rigs"),
					id,
				},
			};
		}
	};
	await Promise.all(Array.from({ length: VOUCHER_READS_AT_ONCE }, worker));
	return {
		readAt: { chainId: 196, block: block.number, time: block.timestamp },
		vouchers,
	};
}
