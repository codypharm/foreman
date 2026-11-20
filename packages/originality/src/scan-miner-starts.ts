// Miners and their design commitments (docs/decisions/2026-11-20-circuit-index.md, decision 4;
// 2026-11-20-verdict-scope-and-earliest-design.md, decision 4). Every miner start emits
// Started on the mining contract, a restart after a stop included. A miner's design commitment
// block is read from getMiner: it stays with the circuit across restarts, and a restart that
// brings a commitment replaces it (verified PodMining source, `start`). Read only.

import { POD_MINING, podMiningAbi } from "@foreman/chain-bnb";
import { type Hex32, parseHex32 } from "@foreman/contract";
import {
	type Address,
	encodePacked,
	type Hex,
	hexToBigInt,
	hexToNumber,
	keccak256,
	numberToHex,
	type PublicClient,
} from "viem";
import type { CircuitId } from "./check-wrapper.ts";
import { LOG_SPAN } from "./scan-tape-outs.ts";

/** Started(bytes32 indexed key, address indexed circuits, uint256 indexed circuitId, uint32 taskId, address registrant, uint64 bstar, uint64 bonus, bool optimal, uint256 verifWeight, uint256 unverWeight, uint32 samplesChecked) */
export const STARTED =
	"0x7c9c1f2b9aa7cd28c79cdeb371997e1c61e4aa92cf7c29b91d01287092f94937" as const;
/** The mining contract's proxy was created at this block; no miner started earlier. */
export const MINING_FIRST_BLOCK = 117_234_441n;
export { POD_MINING };

/** One Started event: a miner starting, or starting again after a stop. */
export interface MinerStart {
	key: Hex32;
	circuit: CircuitId;
	startedAt: { block: bigint; txIndex: number; logIndex: number };
}

export type MinerStartScan =
	| {
			complete: true;
			upToBlock: bigint;
			/** In chain order, as the node returns them. A restarted miner appears once per start. */
			starts: MinerStart[];
	  }
	| { complete: false; reason: "read-failed"; detail: string };

interface RawLog {
	topics: Hex[];
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
}

export async function scanMinerStarts(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	onProgress?: (stage: string) => void,
): Promise<MinerStartScan> {
	const starts: MinerStart[] = [];
	let stage = "";
	try {
		for (let from = range.fromBlock; from <= range.toBlock; from += LOG_SPAN) {
			const to =
				from + LOG_SPAN - 1n < range.toBlock
					? from + LOG_SPAN - 1n
					: range.toBlock;
			stage = `Started read, blocks ${from} to ${to}`;
			onProgress?.(stage);
			const logs = (await client.request({
				method: "eth_getLogs",
				params: [
					{
						address: POD_MINING,
						topics: [STARTED],
						fromBlock: numberToHex(from),
						toBlock: numberToHex(to),
					},
				],
			})) as RawLog[];
			for (const log of logs) {
				starts.push({
					key: parseHex32(log.topics[1] as string, "Started.key"),
					circuit: {
						processor: `0x${(log.topics[2] as Hex).slice(26)}` as Address,
						id: hexToBigInt(log.topics[3] as Hex),
					},
					startedAt: {
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
	return { complete: true, upToBlock: range.toBlock, starts };
}

/** The mining contract's key for a circuit: keccak256(abi.encodePacked(circuits, circuitId)). */
export function minerKey(circuit: CircuitId): Hex32 {
	return parseHex32(
		keccak256(
			encodePacked(["address", "uint256"], [circuit.processor, circuit.id]),
		),
		"minerKey",
	);
}

export type CommitmentRead =
	/**
	 * null: the miner started without a design commitment, so its design time is its tape-out.
	 * Otherwise the commitment's block and that block's time (Unix seconds).
	 */
	| { read: true; committedAt: { block: bigint; time: bigint } | null }
	| { read: false; detail: string };

export async function readDesignCommitment(
	client: PublicClient,
	key: Hex32,
	at: { blockNumber: bigint },
): Promise<CommitmentRead> {
	let stage = `getMiner(${key}) at block ${at.blockNumber}`;
	try {
		const m = await client.readContract({
			address: POD_MINING,
			abi: podMiningAbi,
			functionName: "getMiner",
			args: [key],
			blockNumber: at.blockNumber,
		});
		if (m.commitBlock === 0n) return { read: true, committedAt: null };
		stage = `getMiner(${key}): commitment block ${m.commitBlock}`;
		const block = await client.getBlock({ blockNumber: m.commitBlock });
		return {
			read: true,
			committedAt: { block: m.commitBlock, time: block.timestamp },
		};
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ?? "read failed";
		return { read: false, detail: `${stage}: ${short}` };
	}
}
