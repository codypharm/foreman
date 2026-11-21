// What counts as a change (docs/decisions/2026-11-21-publish-job.md, decision 6). A circuit is
// published again when its verdict kind, the evidence for that kind, its can-mine state or, for
// "can't mine", its set of reasons differs from its last publish. A moved stop block, a new index
// block or a changed count is not a change.

import type { CircuitRef, Hex32, Originality } from "@foreman/contract";
import { keccak256, toBytes } from "viem";

/** keccak256 of the parts of a result whose change triggers a new publish. */
export function changeFingerprint(o: Originality): Hex32 {
	const parts = { verdict: evidence(o.result), canMine: canMine(o) };
	return keccak256(toBytes(JSON.stringify(parts))) as Hex32;
}

function evidence(r: Originality["result"]): unknown {
	switch (r.verdict) {
		case "copy":
			return [r.verdict, id(r.of), r.netlistHash];
		case "too-small-to-tell":
			return [r.verdict, id(r.earliest), r.netlistHash];
		case "wrapper":
			return [r.verdict, ids(r.pointsTo), ids(r.finalTargets)];
		case "no-earlier-copy":
			return [r.verdict, r.netlistHash];
		case "cant-check":
			return [r.verdict, r.reason];
	}
}

function canMine(o: Originality): unknown {
	const fact = o.facts.find((f) => f.fact === "can-mine");
	if (!fact) throw new Error("a result carries exactly one can-mine fact");
	if (fact.state !== "cant-mine") return [fact.state];
	return [fact.state, [...new Set(fact.reasons.map((r) => r.reason))].sort()];
}

const id = (c: CircuitRef) => `${c.processor.toLowerCase()}/${c.tokenId}`;
const ids = (cs: CircuitRef[]) => [...new Set(cs.map(id))].sort();
