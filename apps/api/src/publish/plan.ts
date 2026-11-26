// The publish plan (docs/decisions/2026-11-21-publish-job.md, decisions 4 and 6): every result
// whose change fingerprint differs from its last publish, as the results contract takes it. The
// logged bytes are the data contract's wire JSON for the Originality, and the contract stores
// keccak256 of exactly those bytes (2026-11-21-results-contract.md, decision 7).

import { minerKey } from "@foreman/chain-bnb";
import { changeFingerprint, shortVerdict } from "@foreman/chain-xlayer/results";
import {
	bnbIndexBlock,
	type Hex32,
	type Originality,
	serialiseOriginality,
} from "@foreman/contract";
import type { PublishedEntry, PublishedRow } from "@foreman/index";
import { type Hex, keccak256, stringToHex } from "viem";

/** The results contract's short verdict codes (ForemanResults.sol, Verdict). */
export { shortVerdict };

export type PlanEntry = PublishedEntry & {
	/** The logged JSON, as bytes. */
	result: Hex;
};

export interface Plan {
	entries: PlanEntry[];
	/** Results whose fingerprint matches their last publish. */
	unchanged: number;
}

export function planPublish(
	results: Originality[],
	published: Map<Hex32, PublishedRow>,
): Plan {
	const entries: PlanEntry[] = [];
	let unchanged = 0;
	// Every stored result from both chains is planned at once, so a key two circuits share shows
	// here: the whole publish stops (2026-11-26-fabx-publishing.md, decision 2)
	const planned = new Map<Hex32, Originality>();
	for (const o of results) {
		const entry = planEntry(o);
		const other = planned.get(entry.key);
		if (other) {
			throw new Error(
				`key ${entry.key} is planned twice: circuit ${o.circuit.processor} #${o.circuit.tokenId} on chain ${other.circuit.chainId} and on chain ${o.circuit.chainId}`,
			);
		}
		planned.set(entry.key, o);
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
		// The BNB Chain block, for FabX results too (2026-11-25-fabx-copy-check.md, decision 7)
		indexBlock: bnbBlock(o),
		result,
	};
}

/** The BNB Chain block a result's index was read up to. */
export const bnbBlock = (o: Originality): bigint => bnbIndexBlock(o.index);
