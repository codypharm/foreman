// The copy check (docs/decisions/2026-11-20-copy-and-wrapper-rules.md, decisions 3 and 4;
// 2026-11-20-verdict-scope-and-earliest-design.md, decisions 4 and 5). Code decides, never a
// model: the same index and rules always give the same result.

import type { Hex32 } from "@foreman/contract";
import type { Address } from "viem";
import type { CircuitId } from "./check-wrapper.ts";

/** One circuit as the index holds it. */
export interface IndexEntry {
	circuit: CircuitId;
	netlistHash: Hex32;
	byteHash: Hex32;
	/** From circuitInfo. */
	gateCount: number;
	/** Position in the chain, and the block's time (Unix seconds). */
	tapedOutAt: {
		block: bigint;
		txIndex: number;
		logIndex: number;
		time: bigint;
	};
	tapedOutBy: Address;
	/** The design commitment the mining contract accepted (its block and that block's time), or null. */
	designCommittedAt: { block: bigint; time: bigint } | null;
}

export interface CircuitIndex {
	entries: IndexEntry[];
	upToBlock: bigint;
}

export type CopyCheck =
	/** Shown as "No earlier copy found among N circuits checked, up to block B". Never "original". */
	| { kind: "no-earlier-copy"; circuitsChecked: number; upToBlock: bigint }
	/** Shown as "Can't check", never as "No earlier copy found". */
	| { kind: "cant-check"; reason: "outside-index"; detail: string }
	/** Identical to earlier circuits but below the stated floor, where honest circuits match by nature. */
	| {
			kind: "too-small-to-tell";
			/** How many earlier circuits share the netlist hash. */
			sameAs: number;
			earliest: IndexEntry;
			gateCount: number;
			floor: number;
	  }
	| {
			kind: "copy";
			/** The earliest circuit with the same netlist hash. */
			of: IndexEntry;
			bytesIdentical: boolean;
			/** What made `of` earlier: its tape-out, or a design commitment before this circuit's. */
			earlierBy: "tape-out" | "commitment";
			/** Whether `of` was taped out by the same address. A fact beside the verdict. */
			sameAddress: boolean;
	  };

export function checkCopy(
	target: CircuitId,
	index: CircuitIndex,
	rules: { sizeFloor: number },
): CopyCheck {
	const self = index.entries.find((e) => same(e.circuit, target));
	if (!self) {
		return {
			kind: "cant-check",
			reason: "outside-index",
			detail: `${target.processor}/${target.id} is not among the ${index.entries.length} circuits indexed up to block ${index.upToBlock}`,
		};
	}
	const earlier = index.entries
		.filter(
			(e) => e.netlistHash === self.netlistHash && !same(e.circuit, target),
		)
		.filter((e) => compare(e, self) < 0)
		.sort(compare);
	const of = earlier[0];
	if (!of) {
		return {
			kind: "no-earlier-copy",
			circuitsChecked: index.entries.length,
			upToBlock: index.upToBlock,
		};
	}
	if (self.gateCount < rules.sizeFloor) {
		return {
			kind: "too-small-to-tell",
			sameAs: earlier.length,
			earliest: of,
			gateCount: self.gateCount,
			floor: rules.sizeFloor,
		};
	}
	return {
		kind: "copy",
		of,
		bytesIdentical: of.byteHash === self.byteHash,
		earlierBy: compareTapeOut(of, self) < 0 ? "tape-out" : "commitment",
		sameAddress: of.tapedOutBy === self.tapedOutBy,
	};
}

/**
 * A circuit's design time: its accepted design commitment block when that came before its
 * tape-out block, otherwise its tape-out block (decision 4).
 */
function designTime(e: IndexEntry): bigint {
	const c = e.designCommittedAt?.block ?? null;
	return c !== null && c < e.tapedOutAt.block ? c : e.tapedOutAt.block;
}

/** Earlier design time first; in the same block, the lower tape-out (block, transaction, log). */
function compare(a: IndexEntry, b: IndexEntry): number {
	const d = designTime(a) - designTime(b);
	return d !== 0n ? (d < 0n ? -1 : 1) : compareTapeOut(a, b);
}

function compareTapeOut(a: IndexEntry, b: IndexEntry): number {
	const x = a.tapedOutAt;
	const y = b.tapedOutAt;
	if (x.block !== y.block) return x.block < y.block ? -1 : 1;
	if (x.txIndex !== y.txIndex) return x.txIndex - y.txIndex;
	return x.logIndex - y.logIndex;
}

const same = (a: CircuitId, b: CircuitId) =>
	a.processor.toLowerCase() === b.processor.toLowerCase() && a.id === b.id;
