// The tape-out scan (docs/decisions/2026-11-20-circuit-index.md, decision 2): every TapedOut
// event since the factory's creation, kept only from processors the factory lists, with each
// processor's event count checked against its nextId(). Read only.

import {
	type Address,
	type Hex,
	hexToBigInt,
	hexToNumber,
	numberToHex,
	type PublicClient,
} from "viem";
import type { CircuitId } from "./check-wrapper.ts";

/** The processor factory on BNB Chain (CLAUDE.md, "On-chain facts"). */
export const FACTORY = "0x68224f668083c29e9800be2a646d42d18cedf7e2" as const;
/** TapedOut(uint256 indexed id, address indexed owner, uint32, uint32) */
export const TAPED_OUT =
	"0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031" as const;
/** The archive endpoint refuses log reads over 50,000 blocks (CLAUDE.md, "RPC notes"). */
export const LOG_SPAN = 50_000n;

export const factoryAbi = [
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

export const processorAbi = [
	/** The last id issued, despite its name (packages/originality/fixtures/README.md). */
	{
		name: "nextId",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

/** One tape-out as the chain records it. */
export interface TapeOut {
	circuit: CircuitId;
	tapedOutAt: { block: bigint; txIndex: number; logIndex: number };
	tapedOutBy: Address;
}

export type TapeOutScan =
	| {
			complete: true;
			upToBlock: bigint;
			/** Every processor the factory listed at upToBlock, lower case. */
			processors: Address[];
			/** In chain order (block, transaction index, log index), as the node returns them. */
			tapeOuts: TapeOut[];
			/** TapedOut events from contracts the factory doesn't list: dropped, kept here to be logged. */
			dropped: DroppedEvent[];
	  }
	/** A gap is never left silently: the index stops (decision 2, the count check). */
	| {
			complete: false;
			reason: "count-mismatch";
			mismatches: CountMismatch[];
			detail: string;
	  }
	| { complete: false; reason: "read-failed"; detail: string };

export interface CountMismatch {
	processor: Address;
	/** TapedOut events read for this processor. */
	events: number;
	/** The last id the processor issued by the scan's last block. */
	nextId: number;
}

export interface DroppedEvent {
	address: Address;
	id: bigint;
	tapedOutAt: TapeOut["tapedOutAt"];
}

interface RawLog {
	address: string;
	topics: Hex[];
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
}

export async function scanTapeOuts(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
): Promise<TapeOutScan> {
	let stage = `processor list at block ${range.toBlock}`;
	try {
		return await scan(client, range, (s) => {
			stage = s;
		});
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
}

async function scan(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	reading: (stage: string) => void,
): Promise<TapeOutScan> {
	const at = { blockNumber: range.toBlock };
	const count = await client.readContract({
		address: FACTORY,
		abi: factoryAbi,
		functionName: "cpuCount",
		...at,
	});
	const processors: Address[] = [];
	const issued = new Map<Address, number>();
	for (let i = 0n; i < count; i++) {
		const p = await client.readContract({
			address: FACTORY,
			abi: factoryAbi,
			functionName: "cpuAt",
			args: [i],
			...at,
		});
		const last = await client.readContract({
			address: p,
			abi: processorAbi,
			functionName: "nextId",
			...at,
		});
		processors.push(p.toLowerCase() as Address);
		issued.set(p.toLowerCase() as Address, Number(last));
	}

	const listed = new Set(processors);
	const tapeOuts: TapeOut[] = [];
	const dropped: DroppedEvent[] = [];
	for (let from = range.fromBlock; from <= range.toBlock; from += LOG_SPAN) {
		const to =
			from + LOG_SPAN - 1n < range.toBlock
				? from + LOG_SPAN - 1n
				: range.toBlock;
		reading(`TapedOut read, blocks ${from} to ${to}`);
		const logs = (await client.request({
			method: "eth_getLogs",
			params: [
				{
					topics: [TAPED_OUT],
					fromBlock: numberToHex(from),
					toBlock: numberToHex(to),
				},
			],
		})) as RawLog[];
		for (const log of logs) {
			const processor = log.address.toLowerCase() as Address;
			const id = hexToBigInt(log.topics[1] as Hex);
			const tapedOutAt = {
				block: hexToBigInt(log.blockNumber),
				txIndex: hexToNumber(log.transactionIndex),
				logIndex: hexToNumber(log.logIndex),
			};
			if (!listed.has(processor)) {
				dropped.push({ address: processor, id, tapedOutAt });
				continue;
			}
			tapeOuts.push({
				circuit: { processor, id },
				tapedOutAt,
				tapedOutBy: `0x${(log.topics[2] as Hex).slice(26)}` as Address,
			});
		}
	}
	const events = new Map<Address, number>();
	for (const t of tapeOuts) {
		const p = t.circuit.processor;
		events.set(p, (events.get(p) ?? 0) + 1);
	}
	const mismatches = processors
		.map((processor) => ({
			processor,
			events: events.get(processor) ?? 0,
			nextId: issued.get(processor) ?? 0,
		}))
		.filter((m) => m.events !== m.nextId);
	if (mismatches.length > 0) {
		return {
			complete: false,
			reason: "count-mismatch",
			mismatches,
			detail: mismatches
				.map(
					(m) =>
						`${m.processor}: ${m.events} TapedOut events, nextId ${m.nextId}, blocks ${range.fromBlock} to ${range.toBlock}`,
				)
				.join("; "),
		};
	}
	return {
		complete: true,
		upToBlock: range.toBlock,
		processors,
		tapeOuts,
		dropped,
	};
}
