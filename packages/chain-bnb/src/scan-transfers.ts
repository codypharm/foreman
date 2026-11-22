// The circuit NFTs' transfers on the two eligible processors (docs/decisions/2026-11-21-api-endpoints.md,
// decision 5; 2026-11-22-wallet-miners.md): every ERC-721 Transfer, mints included, in chain order,
// so the index can keep each circuit's current owner. Read only.

import { type Address, parseAddress } from "@foreman/contract";
import {
	type Hex,
	hexToBigInt,
	hexToNumber,
	numberToHex,
	type PublicClient,
} from "viem";
import { PROCESSOR_MULTIPLIERS } from "./abi.ts";

/** Transfer(address indexed from, address indexed to, uint256 indexed tokenId) */
export const TRANSFER =
	"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
/** Blocks per log read; the client splits it further for each node (2026-11-21-bnb-nodes.md). */
const LOG_SPAN = 50_000n;

export interface CircuitTransfer {
	processor: Address;
	id: bigint;
	/** 0x0 for a mint, at tape-out. */
	from: Address;
	to: Address;
	at: { block: bigint; txIndex: number; logIndex: number };
}

export type CircuitTransferScan =
	| {
			complete: true;
			fromBlock: bigint;
			upToBlock: bigint;
			transfers: CircuitTransfer[];
	  }
	| { complete: false; reason: "read-failed"; detail: string };

interface RawLog {
	address: string;
	topics: Hex[];
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
}

const topicAddress = (topic: Hex | undefined, field: string) =>
	parseAddress(`0x${(topic ?? "").slice(26)}`.toLowerCase(), field);

export async function scanCircuitTransfers(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	onProgress?: (stage: string) => void,
): Promise<CircuitTransferScan> {
	const processors = Object.keys(PROCESSOR_MULTIPLIERS) as Hex[];
	const transfers: CircuitTransfer[] = [];
	let stage = "";
	try {
		for (let from = range.fromBlock; from <= range.toBlock; from += LOG_SPAN) {
			const to =
				from + LOG_SPAN - 1n < range.toBlock
					? from + LOG_SPAN - 1n
					: range.toBlock;
			stage = `Transfer read, blocks ${from} to ${to}`;
			onProgress?.(stage);
			const logs = (await client.request({
				method: "eth_getLogs",
				params: [
					{
						address: processors,
						topics: [TRANSFER],
						fromBlock: numberToHex(from),
						toBlock: numberToHex(to),
					},
				],
			})) as RawLog[];
			for (const log of logs) {
				transfers.push({
					processor: parseAddress(log.address.toLowerCase(), "Transfer"),
					id: hexToBigInt(log.topics[3] as Hex),
					from: topicAddress(log.topics[1], "Transfer.from"),
					to: topicAddress(log.topics[2], "Transfer.to"),
					at: {
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
			(error as { shortMessage?: string }).shortMessage ??
			(error as Error).message ??
			"read failed";
		return {
			complete: false,
			reason: "read-failed",
			detail: `${stage}: ${short}`,
		};
	}
	// Reads come back in block order, the two processors mixed: put them in chain order
	transfers.sort(
		(a, b) =>
			Number(a.at.block - b.at.block) ||
			a.at.txIndex - b.at.txIndex ||
			a.at.logIndex - b.at.logIndex,
	);
	return {
		complete: true,
		fromBlock: range.fromBlock,
		upToBlock: range.toBlock,
		transfers,
	};
}
