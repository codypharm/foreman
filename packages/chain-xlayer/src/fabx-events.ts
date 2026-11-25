// FabX's logs decoded into what Foreman stores (docs/decisions/2026-11-25-fabx-storage.md):
// tape-outs from FabX's processor; design commitments, starts and contract changes from FabX's
// mining contract. Addresses are from CLAUDE.md's "On-chain facts"; a log from any other address
// is refused, never guessed at. Events are matched by topic hash, never by name. Read only.

import { type Address, type Hex, keccak256, toHex } from "viem";
import type { XLayerLog } from "./read-logs.ts";

/** FabX's processor and mining contract on X Layer (CLAUDE.md, "On-chain facts", 25 Nov 2026). */
export const FABX_PROCESSOR = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
export const FABX_MINING = "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265" as const;
/** The processor's creation block: no FabX log is earlier. */
export const FABX_FIRST_BLOCK = 73_042_958n;

const topic = (signature: string) => keccak256(toHex(signature));
export const FABX_TOPICS = {
	TapedOut: topic("TapedOut(uint256,address,uint32,uint32)"),
	DesignCommitted: topic("DesignCommitted(bytes32,address,address,uint256,uint64)"),
	Started: topic(
		"Started(bytes32,address,uint256,uint32,address,uint64,uint64,bool,uint256,uint256,uint32)",
	),
	Upgraded: topic("Upgraded(address)"),
	OwnershipTransferred: topic("OwnershipTransferred(address,address)"),
	ProcessorSet: topic("ProcessorSet(address,uint256)"),
	Paused: topic("Paused(address)"),
	Unpaused: topic("Unpaused(address)"),
	BoostSet: topic("BoostSet(address)"),
} as const;

/** A log's place in the chain. */
export interface LogAt {
	block: bigint;
	tx: number;
	log: number;
}

export interface FabxTapeOut {
	processor: Address;
	id: bigint;
	at: LogAt;
	time: bigint;
	tapedOutBy: Address;
}

export interface FabxCommitment {
	at: LogAt;
	txHash: Hex;
	time: bigint;
	commitment: Hex;
	designer: Address;
	circuits: Address;
	/** The event's own block field: earlier than at.block for a commitment migrated in. */
	claimedBlock: bigint;
	firstUnusedId: bigint;
}

export interface FabxStart {
	at: LogAt;
	key: Hex;
	processor: Address;
	id: bigint;
	registrant: Address;
}

export type FabxContractEventKind =
	| "Upgraded"
	| "OwnershipTransferred"
	| "ProcessorSet"
	| "Paused"
	| "Unpaused"
	| "BoostSet";

export interface FabxContractEvent {
	at: LogAt;
	txHash: Hex;
	time: bigint;
	kind: FabxContractEventKind;
	/** The event's fields, as text. */
	detail: Record<string, string>;
}

export type FabxHistory =
	| {
			ok: true;
			tapeOuts: FabxTapeOut[];
			commitments: FabxCommitment[];
			starts: FabxStart[];
			contractEvents: FabxContractEvent[];
			/** Logs of other events (transfers, claims, task settings): not stored. */
			otherLogs: number;
	  }
	| { ok: false; detail: string };

export function decodeFabxLogs(logs: readonly XLayerLog[]): FabxHistory {
	try {
		return decode(logs);
	} catch (error) {
		return { ok: false, detail: (error as Error).message };
	}
}

function decode(logs: readonly XLayerLog[]): FabxHistory {
	const h = {
		ok: true as const,
		tapeOuts: [] as FabxTapeOut[],
		commitments: [] as FabxCommitment[],
		starts: [] as FabxStart[],
		contractEvents: [] as FabxContractEvent[],
		otherLogs: 0,
	};
	for (const l of logs) {
		const where = `block ${l.blockNumber}, log ${l.logIndex}`;
		if (l.blockTimestamp === undefined)
			return { ok: false, detail: `${where}: the node returned no block time` };
		const at = { block: l.blockNumber, tx: l.transactionIndex, log: l.logIndex };
		const time = l.blockTimestamp;
		const t0 = l.topics[0];
		if (l.address === FABX_PROCESSOR) {
			if (t0 === FABX_TOPICS.TapedOut)
				h.tapeOuts.push({
					processor: FABX_PROCESSOR,
					id: BigInt(topicAt(l, 1)),
					at,
					time,
					tapedOutBy: address(topicAt(l, 2)),
				});
			else h.otherLogs++;
			continue;
		}
		if (l.address !== FABX_MINING)
			return { ok: false, detail: `${where}: a log from ${l.address}, not FabX's` };
		const base = { at, txHash: l.transactionHash, time };
		switch (t0) {
			case FABX_TOPICS.DesignCommitted:
				h.commitments.push({
					...base,
					commitment: topicAt(l, 1),
					designer: address(topicAt(l, 2)),
					circuits: address(topicAt(l, 3)),
					claimedBlock: word(l.data, 0),
					firstUnusedId: word(l.data, 1),
				});
				break;
			case FABX_TOPICS.Started:
				h.starts.push({
					at,
					key: topicAt(l, 1),
					processor: address(topicAt(l, 2)),
					id: BigInt(topicAt(l, 3)),
					registrant: address(`0x${l.data.slice(2 + 64, 2 + 128)}`),
				});
				break;
			case FABX_TOPICS.Upgraded:
				h.contractEvents.push({ ...base, kind: "Upgraded", detail: { implementation: address(topicAt(l, 1)) } });
				break;
			case FABX_TOPICS.OwnershipTransferred:
				h.contractEvents.push({
					...base,
					kind: "OwnershipTransferred",
					detail: { from: address(topicAt(l, 1)), to: address(topicAt(l, 2)) },
				});
				break;
			case FABX_TOPICS.ProcessorSet:
				h.contractEvents.push({
					...base,
					kind: "ProcessorSet",
					detail: { processor: address(topicAt(l, 1)), multiplier: word(l.data, 0).toString() },
				});
				break;
			case FABX_TOPICS.Paused:
			case FABX_TOPICS.Unpaused:
				h.contractEvents.push({
					...base,
					kind: t0 === FABX_TOPICS.Paused ? "Paused" : "Unpaused",
					detail: { account: address(`0x${l.data.slice(2, 66)}`) },
				});
				break;
			case FABX_TOPICS.BoostSet:
				h.contractEvents.push({ ...base, kind: "BoostSet", detail: { boost: address(`0x${l.data.slice(2, 66)}`) } });
				break;
			default:
				h.otherLogs++;
		}
	}
	return h;
}

function topicAt(l: XLayerLog, i: number): Hex {
	const t = l.topics[i];
	if (!t) throw new Error(`block ${l.blockNumber}, log ${l.logIndex}: topic ${i} missing`);
	return t;
}
const address = (h: string) => `0x${h.slice(-40)}`.toLowerCase() as Address;
const word = (data: Hex, i: number) => BigInt(`0x${data.slice(2 + 64 * i, 2 + 64 * (i + 1)) || "0"}`);
