// Originality: one circuit's verdict with its evidence, rule version and block. Shapes exactly as
// in docs/data-contract.md ("CircuitRef", "Originality"; provisional). Rules:
// docs/decisions/2026-11-20-copy-and-wrapper-rules.md and the records that amend it. Types only:
// the parsers come with the API.

import type { Address, Hex32 } from "./wire.ts";

export interface CircuitRef {
	chainId: 56 | 196;
	/** The processor contract (the circuit's NFT collection). */
	processor: Address;
	/** The circuit's id on that processor. */
	tokenId: bigint;
	/** Position in the chain, and the block's time (Unix seconds). */
	tapedOutAt: {
		block: bigint;
		txIndex: number;
		logIndex: number;
		time: bigint;
	};
	/** The owner in the processor's TapedOut event. */
	tapedOutBy: Address;
	/** The design commitment the mining contract accepted, and its block's time; only miners can have one. */
	designCommittedAt: { block: bigint; time: bigint } | null;
}

export type OriginalityVerdict =
	/** Netlist is only REF records. chainSteps counts the longest branch, at most 10. */
	| {
			verdict: "wrapper";
			pointsTo: CircuitRef[];
			finalTargets: CircuitRef[];
			chainSteps: number;
	  }
	/** Same netlist hash as a circuit with an earlier design time, at or above the size floor. */
	| {
			verdict: "copy";
			of: CircuitRef;
			netlistHash: Hex32;
			/** false when they match only once NAND inputs are sorted. */
			bytesIdentical: boolean;
			/** What made `of` earlier. */
			earlierBy: "tape-out" | "commitment";
	  }
	/** Identical, below the size floor. */
	| {
			verdict: "too-small-to-tell";
			sameAs: number;
			earliest: CircuitRef;
			netlistHash: Hex32;
			gateCount: number;
			floor: number;
	  }
	| { verdict: "no-earlier-copy"; netlistHash: Hex32 }
	| {
			verdict: "cant-check";
			reason:
				| "netlist-unreadable"
				| "outside-index"
				| "read-failed"
				| "ref-chain-too-long";
	  };

export type CantMineReason =
	/** processorMultiplier is 0. */
	| { reason: "processor-not-eligible" }
	/** The netlist has a REF record. */
	| { reason: "uses-ref" }
	/** Revoked, from the Revoked event; it can never start again. */
	| {
			reason: "failed-test-vector";
			taskId: number;
			vectorIndex: number;
			block: bigint;
	  };

export type OriginalityFact =
	/** Beside "copy": the earlier circuit was taped out by the same address, or not. */
	| { fact: "tape-out-address"; same: boolean }
	/** REF records mixed with real gates. */
	| {
			fact: "uses-ref";
			refRecords: number;
			targets: CircuitRef[];
			borrowedGates: number;
			totalGates: number;
	  }
	/** Beside "wrapper": also identical to an earlier circuit. */
	| { fact: "also-identical"; to: CircuitRef; netlistHash: Hex32 }
	/** Every result carries exactly one can-mine fact. */
	| { fact: "can-mine"; state: "mining" }
	| { fact: "can-mine"; state: "cant-mine"; reasons: CantMineReason[] }
	/** Cooling: stopBlock, and stopBlock + 1,200. */
	| {
			fact: "can-mine";
			state: "stopped";
			stoppedAt: bigint;
			canStartFrom: bigint;
	  }
	/** Nothing rules it out; never a promise that it passes a task. */
	| { fact: "can-mine"; state: "not-started" }
	/** Miners only, from getMiner (optimal, bonus); shown before the verdict. */
	| { fact: "design-bonus"; holds: boolean; bonus: bigint }
	/** Miners in the index with the same netlist hash, this one included; only when 2 or more. */
	| { fact: "design-shared"; miners: number };

export interface Originality {
	circuit: CircuitRef;
	/** Why it was checked; only "miner" and "listed" are published. */
	scope: "miner" | "listed" | "pasted";
	result: OriginalityVerdict;
	facts: OriginalityFact[];
	occc:
		| { status: "official"; collection: Address }
		| { status: "not-listed" }
		| { status: "not-checked" };
	index: {
		circuitsChecked: bigint;
		upToBlock: { chainId: 56 | 196; block: bigint };
	};
	/** Every setting that can change the result, spelled out: "hash 2026-11-20, floor 4, chain 10". */
	ruleVersion: string;
}
