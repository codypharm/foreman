// The tape-out scan (docs/decisions/2026-11-20-circuit-index.md, decision 2): every TapedOut
// event since the factory's creation, kept only from processors the factory lists, with each
// processor's event count checked against its nextId(). Read only.

import { MULTICALL3 } from "@foreman/chain-bnb";
import {
	type Address,
	type ContractFunctionParameters,
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
/** The factory's first block with code; no tape-out can be earlier. */
export const FACTORY_FIRST_BLOCK = 116_042_002n;
/**
 * Processors read in one Multicall3 bundle when listing them, and bundles sent at once
 * (docs/decisions/2026-11-22-follow-processor-reads-multicall.md).
 */
const PROCESSORS_PER_BUNDLE = 250;
const BUNDLES_AT_ONCE = 4;
/** publicnode's limit on addresses in one log read, measured 21 Nov 2026 (2026-11-21-bnb-nodes.md). */
const ADDRESSES_PER_READ = 10;

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
	/** Its position in the chain, and its block's time (Unix seconds) from the log. */
	tapedOutAt: {
		block: bigint;
		txIndex: number;
		logIndex: number;
		time: bigint;
	};
	tapedOutBy: Address;
}

export type TapeOutScan =
	| {
			complete: true;
			upToBlock: bigint;
			/** Every processor the factory listed at upToBlock, lower case, with the last id it had issued. */
			processors: ListedProcessor[];
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

export interface ListedProcessor {
	address: Address;
	/** nextId() at the scan's last block: the last id issued. */
	issued: bigint;
}

export interface DroppedEvent {
	address: Address;
	id: bigint;
	tapedOutAt: { block: bigint; txIndex: number; logIndex: number };
}

interface RawLog {
	address: string;
	topics: Hex[];
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
	/** Not every node returns it: a listed tape-out without one stops the scan. */
	blockTimestamp?: Hex;
}

export async function scanTapeOuts(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	/** Called before each read, with what is being read. */
	onProgress?: (stage: string) => void,
	/**
	 * Tape-outs already indexed per processor (lower case), when following from an earlier
	 * scan: the count check is then indexed + read = nextId.
	 */
	indexed: ReadonlyMap<Address, number> = new Map(),
): Promise<TapeOutScan> {
	let stage = `processor list at block ${range.toBlock}`;
	try {
		return await scan(
			client,
			range,
			(s) => {
				stage = s;
				onProgress?.(s);
			},
			indexed,
		);
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

/**
 * View reads at one block in Multicall3 bundles, answers in the reads' order. A read that fails
 * inside its bundle throws, naming it: the scan stops rather than drop a processor.
 */
async function bundled(
	client: PublicClient,
	contracts: readonly ContractFunctionParameters[],
	at: { blockNumber: bigint },
	name: (i: number) => string,
): Promise<unknown[]> {
	const answers: unknown[] = new Array(contracts.length);
	const starts: number[] = [];
	for (let s = 0; s < contracts.length; s += PROCESSORS_PER_BUNDLE)
		starts.push(s);
	for (let g = 0; g < starts.length; g += BUNDLES_AT_ONCE) {
		await Promise.all(
			starts.slice(g, g + BUNDLES_AT_ONCE).map(async (s) => {
				const results = await client.multicall({
					contracts: contracts.slice(s, s + PROCESSORS_PER_BUNDLE),
					multicallAddress: MULTICALL3,
					allowFailure: true,
					batchSize: 0,
					...at,
				});
				results.forEach((r, k) => {
					if (r.status !== "success") {
						// As shortMessage, the only part of an error the scan reports (no node URL in it)
						const shortMessage = `${name(s + k)} failed inside its bundle`;
						throw Object.assign(new Error(shortMessage), { shortMessage });
					}
					answers[s + k] = r.result;
				});
			}),
		);
	}
	return answers;
}

async function scan(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
	reading: (stage: string) => void,
	indexed: ReadonlyMap<Address, number>,
): Promise<TapeOutScan> {
	const at = { blockNumber: range.toBlock };
	const count = await client.readContract({
		address: FACTORY,
		abi: factoryAbi,
		functionName: "cpuCount",
		...at,
	});
	reading(`processors 1 to ${count} at block ${range.toBlock}`);
	const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
	const addresses = await bundled(
		client,
		indexes.map((i) => ({
			address: FACTORY,
			abi: factoryAbi,
			functionName: "cpuAt",
			args: [i],
		})),
		at,
		(i) => `processor ${i + 1} of ${count} (cpuAt)`,
	);
	const issued = await bundled(
		client,
		addresses.map((p) => ({
			address: p as Address,
			abi: processorAbi,
			functionName: "nextId",
		})),
		at,
		(i) => `nextId of ${String(addresses[i]).toLowerCase()}`,
	);
	const processors: ListedProcessor[] = addresses.map((p, i) => ({
		address: String(p).toLowerCase() as Address,
		issued: issued[i] as bigint,
	}));

	const listed = new Set(processors.map((p) => p.address));
	// A follow reads only the processors that issued new ids, a few addresses at a time: the recent
	// node refuses a log read with no address or more than 10 (2026-11-21-bnb-nodes.md). A first
	// scan reads every contract's TapedOut events, so it also sees the ones it drops.
	const groups: (Address[] | null)[] =
		indexed.size === 0
			? [null]
			: chunk(
					processors
						.filter((p) => p.issued > BigInt(indexed.get(p.address) ?? 0))
						.map((p) => p.address),
					ADDRESSES_PER_READ,
				);
	const tapeOuts: TapeOut[] = [];
	const dropped: DroppedEvent[] = [];
	for (let from = range.fromBlock; from <= range.toBlock; from += LOG_SPAN) {
		const to =
			from + LOG_SPAN - 1n < range.toBlock
				? from + LOG_SPAN - 1n
				: range.toBlock;
		reading(`TapedOut read, blocks ${from} to ${to}`);
		const logs: RawLog[] = [];
		for (const group of groups) {
			logs.push(
				...((await client.request({
					method: "eth_getLogs",
					params: [
						{
							...(group ? { address: group } : {}),
							topics: [TAPED_OUT],
							fromBlock: numberToHex(from),
							toBlock: numberToHex(to),
						},
					],
				})) as RawLog[]),
			);
		}
		// Reads by address group come back group by group: put them back in chain order
		logs.sort(
			(a, b) =>
				compare(a.blockNumber, b.blockNumber) ||
				compare(a.transactionIndex, b.transactionIndex) ||
				compare(a.logIndex, b.logIndex),
		);
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
			if (!log.blockTimestamp) {
				return {
					complete: false,
					reason: "read-failed",
					detail: `${processor}/${id} in block ${tapedOutAt.block}: the node returned no block time`,
				};
			}
			tapeOuts.push({
				circuit: { processor, id },
				tapedOutAt: { ...tapedOutAt, time: hexToBigInt(log.blockTimestamp) },
				tapedOutBy: `0x${(log.topics[2] as Hex).slice(26)}` as Address,
			});
		}
	}
	const events = new Map<Address, number>(indexed);
	for (const t of tapeOuts) {
		const p = t.circuit.processor;
		events.set(p, (events.get(p) ?? 0) + 1);
	}
	const mismatches = processors
		.map(({ address, issued }) => ({
			processor: address,
			events: events.get(address) ?? 0,
			nextId: Number(issued),
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
						`${m.processor}: ${m.events} tape-outs indexed and read, nextId ${m.nextId}, blocks ${range.fromBlock} to ${range.toBlock}`,
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

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

function compare(a: Hex, b: Hex): number {
	const x = hexToBigInt(a);
	const y = hexToBigInt(b);
	return x < y ? -1 : x > y ? 1 : 0;
}
