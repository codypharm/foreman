// Wrappers and REF use (docs/decisions/2026-11-20-copy-and-wrapper-rules.md, decisions 5
// and 6; 2026-11-20-wrapper-targets-and-step-limit.md). Following a chain only reads
// netlists; it never evaluates a circuit.

import type { Address, PublicClient } from "viem";
import { type Netlist, readNetlist } from "./read-netlist.ts";

export interface CircuitId {
	processor: Address;
	id: bigint;
}

/** Most REF steps followed on one branch (2026-11-20-wrapper-targets-and-step-limit.md). */
export const MAX_CHAIN_STEPS = 10;

export type WrapperCheck =
	| { kind: "no-ref" }
	/** Shown as "Can't check", never as where the gates are. */
	| {
			kind: "cant-check";
			reason: "ref-chain-too-long" | "netlist-unreadable" | "read-failed";
			detail: string;
	  }
	/** REF records beside gates of its own: a fact beside the verdict, never a verdict. */
	| {
			kind: "uses-ref";
			refRecords: number;
			targets: CircuitId[];
			/** Gates reached through REF: circuitInfo's count minus its own NANDs and LATCHes. */
			borrowedGates: number;
			totalGates: number;
	  }
	| {
			kind: "wrapper";
			/** Every distinct circuit the REF records point to. */
			pointsTo: CircuitId[];
			/** Every circuit where a chain ends: the first with gates of its own. */
			finalTargets: CircuitId[];
			/** Steps on the longest branch. */
			chainSteps: number;
	  };

export async function checkWrapper(
	client: PublicClient,
	netlist: Netlist,
	at: { blockNumber: bigint },
): Promise<WrapperCheck> {
	const refRecords = netlist.records.filter((r) => r.op === "ref").length;
	if (refRecords === 0) return { kind: "no-ref" };
	if (!isPureWrapper(netlist)) {
		const own = netlist.records.length - refRecords;
		return {
			kind: "uses-ref",
			refRecords,
			targets: distinctTargets(netlist),
			borrowedGates: netlist.gateCount - own,
			totalGates: netlist.gateCount,
		};
	}

	const pointsTo = distinctTargets(netlist);
	const finalTargets = new Map<string, CircuitId>();
	let chainSteps = 0;

	type CantCheck = Extract<WrapperCheck, { kind: "cant-check" }>;
	// Each branch walks down while the circuit it reaches is itself a pure wrapper. The first
	// circuit that can't be read, or a branch past the limit, makes the whole check "can't check".
	const follow = async (
		target: CircuitId,
		steps: number,
	): Promise<CantCheck | null> => {
		chainSteps = Math.max(chainSteps, steps);
		const read = await readNetlist(client, target, at);
		if (!read.readable)
			return { kind: "cant-check", reason: read.reason, detail: read.detail };
		if (!isPureWrapper(read.netlist)) {
			finalTargets.set(key(target), target);
			return null;
		}
		if (steps >= MAX_CHAIN_STEPS) {
			return {
				kind: "cant-check",
				reason: "ref-chain-too-long",
				detail: `${key(target)} is still a wrapper after ${MAX_CHAIN_STEPS} steps`,
			};
		}
		for (const next of distinctTargets(read.netlist)) {
			const failed = await follow(next, steps + 1);
			if (failed) return failed;
		}
		return null;
	};
	for (const target of pointsTo) {
		const failed = await follow(target, 1);
		if (failed) return failed;
	}

	return {
		kind: "wrapper",
		pointsTo,
		finalTargets: [...finalTargets.values()],
		chainSteps,
	};
}

const key = (c: CircuitId) => `${c.processor}/${c.id}`;

const isPureWrapper = (n: Netlist) =>
	n.records.length > 0 && n.records.every((r) => r.op === "ref");

function distinctTargets(netlist: Netlist): CircuitId[] {
	const seen = new Map<string, CircuitId>();
	for (const r of netlist.records) {
		if (r.op !== "ref") continue;
		seen.set(key(r.target), r.target);
	}
	return [...seen.values()];
}
