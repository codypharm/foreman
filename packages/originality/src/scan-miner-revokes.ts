// Revoked miners (docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md, decision 1). A
// challenge that proves a wrong answer on one of the task's own test vectors revokes the miner
// for good and emits Revoked; the vector and the block exist only in that event, so the index
// keeps every one. Read only.

import { type Hex32, parseHex32 } from "@foreman/contract";
import {
	type Hex,
	hexToBigInt,
	hexToNumber,
	numberToHex,
	type PublicClient,
} from "viem";
import { POD_MINING } from "./scan-miner-starts.ts";
import { LOG_SPAN } from "./scan-tape-outs.ts";

/** Revoked(bytes32 indexed key, address indexed challenger, uint32 vectorIndex) */
export const REVOKED =
	"0xe52b422ce6b3cd73243c813dcbc499543bb477dd997c5d177b52c03562347ce5" as const;

export interface MinerRevoke {
	key: Hex32;
	/** The task's test vector the circuit answered wrongly. */
	vectorIndex: number;
	revokedAt: { block: bigint; txIndex: number; logIndex: number };
}

export type MinerRevokeScan =
	| { complete: true; upToBlock: bigint; revokes: MinerRevoke[] }
	| { complete: false; reason: "read-failed"; detail: string };

interface RawLog {
	topics: Hex[];
	data: Hex;
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
}

export async function scanMinerRevokes(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	onProgress?: (stage: string) => void,
): Promise<MinerRevokeScan> {
	const revokes: MinerRevoke[] = [];
	let stage = "";
	try {
		for (let from = range.fromBlock; from <= range.toBlock; from += LOG_SPAN) {
			const to =
				from + LOG_SPAN - 1n < range.toBlock
					? from + LOG_SPAN - 1n
					: range.toBlock;
			stage = `Revoked read, blocks ${from} to ${to}`;
			onProgress?.(stage);
			const logs = (await client.request({
				method: "eth_getLogs",
				params: [
					{
						address: POD_MINING,
						topics: [REVOKED],
						fromBlock: numberToHex(from),
						toBlock: numberToHex(to),
					},
				],
			})) as RawLog[];
			for (const log of logs) {
				revokes.push({
					key: parseHex32(log.topics[1] as string, "Revoked.key"),
					vectorIndex: hexToNumber(log.data),
					revokedAt: {
						block: hexToBigInt(log.blockNumber),
						txIndex: hexToNumber(log.transactionIndex),
						logIndex: hexToNumber(log.logIndex),
					},
				});
			}
		}
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ?? "read failed";
		return {
			complete: false,
			reason: "read-failed",
			detail: `${stage}: ${short}`,
		};
	}
	return { complete: true, upToBlock: range.toBlock, revokes };
}
