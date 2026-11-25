// One circuit's originality verdict with its evidence, facts, coverage and rule version, in the
// data contract's shape (docs/data-contract.md, "Originality"). Rules, in order:
// can't check → wrapper → copy or too small to tell → no earlier copy found
// (2026-11-20-copy-and-wrapper-rules.md, as amended; 2026-11-20-size-floor.md;
// 2026-11-20-originality-result.md). Code decides, never a model: the same index always gives the
// same result.

import {
	type CircuitRef,
	type Originality,
	type OriginalityFact,
	type OriginalityIndex,
	type OriginalityVerdict,
	parseAddress,
} from "@foreman/contract";
import { type CircuitIndex, checkCopy, type IndexEntry } from "./check-copy.ts";
import {
	type CircuitId,
	MAX_CHAIN_STEPS,
	type WrapperCheck,
} from "./check-wrapper.ts";
import { HASH_RULE_VERSION } from "./hash.ts";

/** Every setting that can change a result. Changing one is a new ADR and a new rule version. */
export const ORIGINALITY_RULES = {
	hashRule: HASH_RULE_VERSION,
	/** Gates; below it an identical miner is "too small to tell" (2026-11-20-size-floor.md). */
	sizeFloor: 4,
	chainSteps: MAX_CHAIN_STEPS,
} as const;

export const RULE_VERSION = `hash ${ORIGINALITY_RULES.hashRule}, floor ${ORIGINALITY_RULES.sizeFloor}, chain ${ORIGINALITY_RULES.chainSteps}`;

/** The index is BNB Chain only for the MVP (2026-11-20-circuit-index.md). */
const CHAIN_ID = 56;

export interface OriginalityVerdictResult {
	result: OriginalityVerdict;
	/** Every fact except can-mine and design-bonus, which come from the mining contract. */
	facts: OriginalityFact[];
	index: OriginalityIndex;
	ruleVersion: string;
}

export function originalityVerdict(input: {
	target: CircuitId;
	index: CircuitIndex;
	/**
	 * checkWrapper on the target's netlist. When the target's own netlist can't be read, its
	 * read failure as { kind: "cant-check" }.
	 */
	wrapper: WrapperCheck;
}): OriginalityVerdictResult {
	const { target, index } = input;
	const coverage: OriginalityIndex = {
		circuitsChecked: BigInt(index.entries.length),
		upTo: [{ chainId: CHAIN_ID, block: index.upToBlock }],
	};
	const done = (
		result: OriginalityVerdict,
		facts: OriginalityFact[] = [],
	): OriginalityVerdictResult => ({
		result,
		facts,
		index: coverage,
		ruleVersion: RULE_VERSION,
	});

	const { wrapper } = input;
	// 1. Can't read the netlist, or follow its REF chain
	if (wrapper.kind === "cant-check") {
		return done({ verdict: "cant-check", reason: wrapper.reason });
	}
	// 1. Outside the index
	const copy = checkCopy(target, index, ORIGINALITY_RULES);
	if (copy.kind === "cant-check") {
		return done({ verdict: "cant-check", reason: "outside-index" });
	}
	const self = index.entries.find((e) => same(e.circuit, target)) as IndexEntry;
	const refs = (ids: CircuitId[]): CircuitRef[] | null => {
		const found = ids.map((id) =>
			index.entries.find((e) => same(e.circuit, id)),
		);
		return found.every((e) => e !== undefined)
			? found.map((e) => circuitRef(e as IndexEntry))
			: null;
	};

	// 2. A wrapper: its own verdict, with an earlier identical circuit as a fact (decision 7)
	if (wrapper.kind === "wrapper") {
		const pointsTo = refs(wrapper.pointsTo);
		const finalTargets = refs(wrapper.finalTargets);
		if (!pointsTo || !finalTargets) {
			return done({ verdict: "cant-check", reason: "outside-index" });
		}
		const earlier =
			copy.kind === "copy"
				? copy.of
				: copy.kind === "too-small-to-tell"
					? copy.earliest
					: null;
		return done(
			{
				verdict: "wrapper",
				pointsTo,
				finalTargets,
				chainSteps: wrapper.chainSteps,
			},
			earlier
				? [
						{
							fact: "also-identical",
							to: circuitRef(earlier),
							netlistHash: self.netlistHash,
						},
					]
				: [],
		);
	}

	// 3 and 4. Copy, too small to tell, or no earlier copy found
	const facts: OriginalityFact[] = [];
	if (copy.kind === "copy") {
		facts.push({ fact: "tape-out-address", same: copy.sameAddress });
	}
	const miners = index.entries.filter(
		(e) => e.miner && e.netlistHash === self.netlistHash,
	).length;
	if (miners >= 2) facts.push({ fact: "design-shared", miners });
	if (wrapper.kind === "uses-ref") {
		const targets = refs(wrapper.targets);
		if (!targets)
			return done({ verdict: "cant-check", reason: "outside-index" });
		facts.push({
			fact: "uses-ref",
			refRecords: wrapper.refRecords,
			targets,
			borrowedGates: wrapper.borrowedGates,
			totalGates: wrapper.totalGates,
		});
	}

	switch (copy.kind) {
		case "copy":
			return done(
				{
					verdict: "copy",
					of: circuitRef(copy.of),
					netlistHash: self.netlistHash,
					bytesIdentical: copy.bytesIdentical,
					earlierBy: copy.earlierBy,
				},
				facts,
			);
		case "too-small-to-tell":
			return done(
				{
					verdict: "too-small-to-tell",
					sameAs: copy.sameAs,
					earliest: circuitRef(copy.earliest),
					netlistHash: self.netlistHash,
					gateCount: copy.gateCount,
					floor: copy.floor,
				},
				facts,
			);
		case "no-earlier-copy":
			return done(
				{ verdict: "no-earlier-copy", netlistHash: self.netlistHash },
				facts,
			);
	}
}

/**
 * One complete result. A result is built whole or not at all: a circuit outside the index, or a
 * failed mining contract read, is an error for the caller, never a partial Originality.
 */
export function buildOriginality(input: {
	/** The circuit's own CircuitRef, from the index (which holds every tape-out, readable or not). */
	circuit: CircuitRef;
	scope: Originality["scope"];
	verdict: OriginalityVerdictResult;
	/** readCanMine's facts: the design bonus (miners only), then exactly one can-mine fact. */
	mining: OriginalityFact[];
	/** readCanMine's mining contract: the one the circuit has a miner record in, or null. */
	miningContract: Originality["mining"];
}): Originality {
	const canMine = input.mining.filter((f) => f.fact === "can-mine");
	if (canMine.length !== 1) {
		throw new Error(
			`a result carries exactly one can-mine fact; got ${canMine.length}`,
		);
	}
	const bonus = input.mining.filter((f) => f.fact === "design-bonus");
	return {
		circuit: input.circuit,
		scope: input.scope,
		mining: input.miningContract,
		result: input.verdict.result,
		// The contract's own answer first, then Foreman's facts, then whether it can mine
		facts: [...bonus, ...input.verdict.facts, ...canMine],
		occc: { status: "not-checked" },
		index: input.verdict.index,
		ruleVersion: input.verdict.ruleVersion,
	};
}

/** An index entry as the data contract's CircuitRef. */
export function circuitRef(e: IndexEntry): CircuitRef {
	return {
		chainId: CHAIN_ID,
		processor: parseAddress(e.circuit.processor, "processor"),
		tokenId: e.circuit.id,
		tapedOutAt: e.tapedOutAt,
		tapedOutBy: parseAddress(e.tapedOutBy, "tapedOutBy"),
		designCommittedAt: e.designCommittedAt,
	};
}

const same = (a: CircuitId, b: CircuitId) =>
	a.processor.toLowerCase() === b.processor.toLowerCase() && a.id === b.id;
