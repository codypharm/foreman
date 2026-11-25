// The copy check (docs/decisions/2026-11-20-copy-and-wrapper-rules.md, decisions 3 and 4;
// 2026-11-20-verdict-scope-and-earliest-design.md, decisions 4 and 5), across BNB Chain and FabX's
// processor on X Layer (2026-11-25-fabx-copy-check.md, decisions 4 and 5;
// 2026-11-25-cross-chain-check.md). Code decides, never a model: the same index and rules always
// give the same result.

import type { Hex32 } from "@foreman/contract";
import type { Address } from "viem";
import type { CircuitId } from "./check-wrapper.ts";

/** One circuit as the index holds it. */
export interface IndexEntry {
	chainId: 56 | 196;
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
	/** Whether the mining contract has a miner for this circuit. */
	miner: boolean;
	/**
	 * The design commitment the mining contract accepted (its block and that block's time), or
	 * null. For FabX, only one confirmed by its DesignCommitted event.
	 */
	designCommittedAt: { block: bigint; time: bigint } | null;
	/**
	 * FabX only: a commitment FabX reports without its event, at its block and that block's time.
	 * It never sets the order; where counting it would change a result, that result is Can't check.
	 */
	unconfirmedCommitment: { block: bigint; time: bigint } | null;
}

export interface CircuitIndex {
	entries: IndexEntry[];
	/** Each chain the index holds and the block it was read up to, BNB Chain first. */
	upTo: { chainId: 56 | 196; block: bigint }[];
}

/** The BNB Chain block the index was read up to: every index holds BNB Chain, first. */
export function bnbBlockOf(index: CircuitIndex): bigint {
	const bnb = index.upTo.find((u) => u.chainId === 56);
	if (!bnb) throw new Error("the index holds no BNB Chain block");
	return bnb.block;
}

export type CopyCheck =
	/** Shown as "No earlier copy found among N circuits checked, up to block B". Never "original". */
	| {
			kind: "no-earlier-copy";
			circuitsChecked: number;
			upTo: CircuitIndex["upTo"];
	  }
	/** Shown as "Can't check", never as "No earlier copy found". */
	| {
			kind: "cant-check";
			reason: "outside-index" | "commitment-unconfirmed";
			detail: string;
	  }
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
			detail: `${target.processor}/${target.id} is not among the ${index.entries.length} circuits indexed up to ${blocks(index)}`,
		};
	}
	const group = index.entries.filter((e) => e.netlistHash === self.netlistHash);
	const result = checkGroup(self, group, index, rules);
	// Counting one unconfirmed commitment at a time is enough (2026-11-25-cross-chain-check.md, decision 1)
	for (const claimant of group) {
		if (!claimant.unconfirmedCommitment) continue;
		const counted = group.map((e) => (e === claimant ? countClaim(e) : e));
		const me = counted[group.indexOf(self)] as IndexEntry;
		const other = checkGroup(me, counted, index, rules);
		if (named(other) !== named(result)) {
			return {
				kind: "cant-check",
				reason: "commitment-unconfirmed",
				detail: `FabX reports a design commitment for #${claimant.circuit.id} at block ${claimant.unconfirmedCommitment.block} with no DesignCommitted event; counting it would change this result`,
			};
		}
	}
	return result;
}

function checkGroup(
	self: IndexEntry,
	group: IndexEntry[],
	index: CircuitIndex,
	rules: { sizeFloor: number },
): Exclude<CopyCheck, { kind: "cant-check" }> {
	const earlier = group
		.filter((e) => e !== self && isEarlier(e, self))
		// Two earlier circuits in the same second on two chains can't be ordered; either is earlier
		// than this one, and BNB Chain's is named so the result never depends on load order
		.sort((a, b) =>
			isEarlier(a, b) ? -1 : isEarlier(b, a) ? 1 : a.chainId - b.chainId,
		);
	const of = earlier[0];
	if (!of) {
		return {
			kind: "no-earlier-copy",
			circuitsChecked: index.entries.length,
			upTo: index.upTo,
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
		earlierBy: tapedOutEarlier(of, self) ? "tape-out" : "commitment",
		sameAddress: of.tapedOutBy === self.tapedOutBy,
	};
}

/** The verdict and the circuit it names: what "would change" compares. */
function named(c: CopyCheck): string {
	switch (c.kind) {
		case "copy":
			return `copy ${key(c.of)}`;
		case "too-small-to-tell":
			return `too-small-to-tell ${key(c.earliest)}`;
		default:
			return c.kind;
	}
}

/** The entry as if its unconfirmed commitment had been accepted. */
function countClaim(e: IndexEntry): IndexEntry {
	return {
		...e,
		designCommittedAt: e.unconfirmedCommitment,
		unconfirmedCommitment: null,
	};
}

const key = (e: IndexEntry) =>
	`${e.chainId}/${e.circuit.processor.toLowerCase()}/${e.circuit.id}`;
const blocks = (index: CircuitIndex) =>
	index.upTo
		.map((u) => `${u.chainId === 56 ? "BNB" : "X Layer"} block ${u.block}`)
		.join(" and ");

/**
 * A circuit's design block and that block's second: its accepted design commitment when that came
 * before its tape-out, otherwise its tape-out (decision 4).
 */
function design(e: IndexEntry): { block: bigint; time: bigint } {
	const c = e.designCommittedAt;
	return c !== null && c.block < e.tapedOutAt.block ? c : e.tapedOutAt;
}

/**
 * Whether `a` was designed before `b`. On one chain: the earlier design block; in the same block,
 * the lower tape-out (block, transaction, log). Across chains: the earlier second, and the same
 * second is earlier on neither (2026-11-25-fabx-copy-check.md, decision 4).
 */
function isEarlier(a: IndexEntry, b: IndexEntry): boolean {
	if (a.chainId !== b.chainId) return design(a).time < design(b).time;
	const da = design(a).block;
	const db = design(b).block;
	return da !== db ? da < db : tapedOutEarlier(a, b);
}

/** Across chains, by the second; on one chain, by block, transaction and log. */
function tapedOutEarlier(a: IndexEntry, b: IndexEntry): boolean {
	const x = a.tapedOutAt;
	const y = b.tapedOutAt;
	if (a.chainId !== b.chainId) return x.time < y.time;
	if (x.block !== y.block) return x.block < y.block;
	if (x.txIndex !== y.txIndex) return x.txIndex < y.txIndex;
	return x.logIndex < y.logIndex;
}

const same = (a: CircuitId, b: CircuitId) =>
	a.processor.toLowerCase() === b.processor.toLowerCase() && a.id === b.id;
