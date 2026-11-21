// The publish plan (docs/decisions/2026-11-21-publish-job.md, decisions 4 and 6): every result
// whose change fingerprint differs from its last publish, as the results contract takes it. The
// logged bytes are the data contract's wire JSON for the Originality, and the contract stores
// keccak256 of exactly those bytes (2026-11-21-results-contract.md, decision 7).

import { minerKey } from "@foreman/chain-bnb";
import {
	type Hex32,
	type Originality,
	serialiseOriginality,
} from "@foreman/contract";
import type { PublishedEntry, PublishedRow } from "@foreman/index";
import { type Hex, keccak256, stringToHex } from "viem";
import { changeFingerprint } from "./fingerprint.ts";

export type PlanEntry = PublishedEntry & {
	/** The logged JSON, as bytes. */
	result: Hex;
};

export interface Plan {
	entries: PlanEntry[];
	/** Results whose fingerprint matches their last publish. */
	unchanged: number;
}

const KIND: Record<Originality["result"]["verdict"], number> = {
	"no-earlier-copy": 1,
	copy: 2,
	"too-small-to-tell": 3,
	wrapper: 4,
	"cant-check": 5,
};

const CAN_MINE = {
	mining: 1,
	"cant-mine": 2,
	stopped: 3,
	"not-started": 4,
} as const;

/** The results contract's short verdict codes (ForemanResults.sol, Verdict). */
export function shortVerdict(o: Originality): {
	kind: number;
	canMine: number;
} {
	const fact = o.facts.find((f) => f.fact === "can-mine");
	if (!fact) throw new Error("a result carries exactly one can-mine fact");
	return { kind: KIND[o.result.verdict], canMine: CAN_MINE[fact.state] };
}

export function planPublish(
	results: Originality[],
	published: Map<Hex32, PublishedRow>,
): Plan {
	const entries: PlanEntry[] = [];
	let unchanged = 0;
	for (const o of results) {
		const entry = planEntry(o);
		if (published.get(entry.key)?.fingerprint === entry.fingerprint) {
			unchanged++;
			continue;
		}
		entries.push(entry);
	}
	return { entries, unchanged };
}

/** One result as the contract takes it: its key, short verdict, fingerprint and logged bytes. */
export function planEntry(o: Originality): PlanEntry {
	const circuit = { processor: o.circuit.processor, id: o.circuit.tokenId };
	const result = stringToHex(
		JSON.stringify(serialiseOriginality(o, "originality")),
	);
	return {
		key: minerKey(circuit),
		...circuit,
		...shortVerdict(o),
		fingerprint: changeFingerprint(o),
		resultHash: keccak256(result) as Hex32,
		indexBlock: o.index.upToBlock.block,
		result,
	};
}
