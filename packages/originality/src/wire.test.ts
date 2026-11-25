import { POD_MINING } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import {
	parseAddress,
	parseOriginality,
	serialiseOriginality,
} from "@foreman/contract";
import { expect, test } from "vitest";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import {
	buildOriginality,
	checkWrapper,
	circuitRef,
	originalityVerdict,
	readNetlist,
	type WrapperCheck,
} from "./index.ts";
import { fixtureIndex } from "./testing.ts";

// Every real result the fixture's 33 circuits give goes through the data contract's JSON writer and
// back unchanged: the JSON the API sends and the results contract logs
// (docs/decisions/2026-11-21-results-contract.md). The can-mine fact is a stand-in here (mining for
// miners, not started for the rest); reading it is tested in can-mine.test.ts.

test("every result from the fixture reads back unchanged from the data contract's JSON", async () => {
	const index = await fixtureIndex();
	const client = replayClient(fixture);
	const at = { blockNumber: BigInt(fixture.block) };
	const verdicts = new Set<string>();
	for (const entry of index.entries) {
		const read = await readNetlist(client, entry.circuit, at);
		const wrapper: WrapperCheck = read.readable
			? await checkWrapper(client, read.netlist, at)
			: {
					kind: "cant-check",
					reason: "netlist-unreadable",
					detail: read.detail,
				};
		const originality = buildOriginality({
			circuit: circuitRef(entry),
			scope: entry.miner ? "miner" : "listed",
			verdict: originalityVerdict({ target: entry.circuit, index, wrapper }),
			mining: [
				{ fact: "can-mine", state: entry.miner ? "mining" : "not-started" },
			],
			miningContract: entry.miner
				? { chainId: 56, contract: parseAddress(POD_MINING, "POD_MINING") }
				: null,
		});
		const sent = JSON.parse(
			JSON.stringify(serialiseOriginality(originality, "originality")),
		);
		expect(parseOriginality(sent, "originality")).toEqual(originality);
		verdicts.add(originality.result.verdict);
	}
	expect(index.entries).toHaveLength(33);
	// The fixture's circuits give four verdicts; "can't check" is covered in originality.test.ts
	expect([...verdicts].sort()).toEqual([
		"copy",
		"no-earlier-copy",
		"too-small-to-tell",
		"wrapper",
	]);
});
