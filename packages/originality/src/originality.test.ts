import { replayClient } from "@foreman/chain-bnb/fixture";
import type { Address } from "viem";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import {
	type CircuitId,
	checkWrapper,
	ORIGINALITY_RULES,
	originalityVerdict,
	RULE_VERSION,
	readNetlist,
	type WrapperCheck,
} from "./index.ts";
import { fixtureIndex } from "./testing.ts";

// One circuit's verdict, facts, coverage and rule version, in the data contract's shape
// (docs/data-contract.md, "Originality"). The fixture's 33 real circuits at block 134,673,279
// (fixtures/README.md). Expected positions, times and addresses were read from the saved JSON
// with Python, not from this code.
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c" as const;
const F441 = "0xf4412c52ec3ddf7caf5f518b6662f77b02bde28e" as const;
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9" as const;
const WRAPS = "0xc1ae0d87cde4f93bcae38c6d62a269c76d5d3215" as const;
const NO_REF = { kind: "no-ref" } as const;

/** The real wrapper check on a fixture circuit's netlist. */
async function wrapperCheck(c: CircuitId): Promise<WrapperCheck> {
	const client = replayClient(fixture);
	const at = { blockNumber: 134_673_279n };
	const read = await readNetlist(client, c, at);
	if (!read.readable) throw new Error(read.detail);
	return checkWrapper(client, read.netlist, at);
}

describe("the rules", () => {
	test("spell out every setting that can change a result", () => {
		expect(ORIGINALITY_RULES).toEqual({
			hashRule: "2026-11-20",
			sizeFloor: 4,
			chainSteps: 10,
		});
		expect(RULE_VERSION).toBe("hash 2026-11-20, floor 4, chain 10");
	});
});

describe("a copy", () => {
	test("names the earlier circuit with both positions and times, the hash, and the facts beside it", async () => {
		const index = await fixtureIndex();
		const self = index.entries.find(
			(e) => e.circuit.processor === MINE6 && e.circuit.id === 1008n,
		);
		const result = originalityVerdict({
			target: { processor: MINE6, id: 1008n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toEqual({
			verdict: "copy",
			of: {
				chainId: 56,
				processor: F441,
				tokenId: 63n,
				tapedOutAt: {
					block: 117_236_264n,
					txIndex: 55,
					logIndex: 269,
					time: 1_787_317_160n,
				},
				tapedOutBy: "0x09b01337511fa81e3962591f687905e6fd4c492c",
				designCommittedAt: null,
			},
			netlistHash: self?.netlistHash,
			bytesIdentical: true,
			earlierBy: "tape-out",
		});
		// 0x0a35… taped out /1008, 0x09b0… taped out /63
		expect(result.facts).toContainEqual({
			fact: "tape-out-address",
			same: false,
		});
		// Miners MINE6/1008, /1144 and /1147 share the design; 0xf441…/63 is not a miner
		expect(result.facts).toContainEqual({ fact: "design-shared", miners: 3 });
		expect(result.index).toEqual({
			circuitsChecked: 33n,
			upToBlock: { chainId: 56, block: 134_673_279n },
		});
		expect(result.ruleVersion).toBe("hash 2026-11-20, floor 4, chain 10");
	});
});

describe("no earlier copy", () => {
	test("is stated with its hash and coverage, never as original, and adds no shared-design fact for a non-miner alone", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: P0, id: 1n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toMatchObject({ verdict: "no-earlier-copy" });
		expect(result.facts).toEqual([]);
		expect(result.index.circuitsChecked).toBe(33n);
	});
});

describe("the earliest proven design", () => {
	test("calls the earlier tape-out the copy of a circuit whose design commitment came first, giving the commitment's block and time", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: MINE6, id: 2510n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toMatchObject({
			verdict: "copy",
			of: {
				processor: MINE6,
				tokenId: 2683n,
				tapedOutAt: {
					block: 127_718_339n,
					txIndex: 101,
					logIndex: 640,
					time: 1_792_036_565n,
				},
				tapedOutBy: "0x697efe8016e09457c794e2339ca764cae3a28ec8",
				designCommittedAt: { block: 122_268_369n, time: 1_789_582_759n },
			},
			earlierBy: "commitment",
		});
		expect(result.facts).toContainEqual({ fact: "design-shared", miners: 2 });
	});

	test("never calls the circuit that committed first a copy", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: MINE6, id: 2683n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toMatchObject({ verdict: "no-earlier-copy" });
		// The later tape-out /2510 uses the same design
		expect(result.facts).toEqual([{ fact: "design-shared", miners: 2 }]);
	});
});

describe("too small to tell", () => {
	test("below 4 gates, names the earliest identical circuit and how many came earlier, with no address fact", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: P0, id: 1251n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toMatchObject({
			verdict: "too-small-to-tell",
			sameAs: 3,
			earliest: {
				processor: P0,
				tokenId: 42n,
				tapedOutAt: {
					block: 116_733_160n,
					txIndex: 43,
					logIndex: 449,
					time: 1_787_090_696n,
				},
			},
			gateCount: 3,
			floor: 4,
		});
		expect(result.facts).toEqual([]);
	});
});

describe("the same address", () => {
	test("is a fact beside a copy, when the earlier circuit was taped out by the same address", async () => {
		// The fixture has no same-address copy at 4 gates or more, so this changes the real index:
		// 0xf441…/63 is given the address that taped out MINE6/1008
		const real = await fixtureIndex();
		const index = {
			...real,
			entries: real.entries.map((e) =>
				e.circuit.processor === F441 && e.circuit.id === 63n
					? {
							...e,
							tapedOutBy:
								"0x0a3570924483d24336abb44136ab7816854ad444" as Address,
						}
					: e,
			),
		};
		const result = originalityVerdict({
			target: { processor: MINE6, id: 1008n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toMatchObject({
			verdict: "copy",
			of: { processor: F441, tokenId: 63n },
		});
		expect(result.facts).toContainEqual({
			fact: "tape-out-address",
			same: true,
		});
	});
});

describe("can't check", () => {
	test("a circuit outside the index is can't check, never no earlier copy found", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: MINE6, id: 999_999n },
			index,
			wrapper: NO_REF,
		});
		expect(result.result).toEqual({
			verdict: "cant-check",
			reason: "outside-index",
		});
		expect(result.facts).toEqual([]);
	});
});

describe("a wrapper (listed circuits only: a miner can't have a REF record)", () => {
	test("names its target and where the chain ends, and notes an earlier identical circuit as a fact", async () => {
		const index = await fixtureIndex();
		const target = { processor: WRAPS, id: 109n };
		const self = index.entries.find(
			(e) => e.circuit.processor === WRAPS && e.circuit.id === 109n,
		);
		const result = originalityVerdict({
			target,
			index,
			wrapper: await wrapperCheck(target),
		});
		expect(result.result).toMatchObject({
			verdict: "wrapper",
			pointsTo: [{ processor: MINE6, tokenId: 512n }],
			finalTargets: [{ processor: MINE6, tokenId: 512n }],
			chainSteps: 1,
		});
		// WRAPS/106 is identical and earlier (same block and transaction, lower log index)
		expect(result.facts).toEqual([
			{
				fact: "also-identical",
				to: expect.objectContaining({
					processor: WRAPS,
					tokenId: 106n,
					tapedOutAt: {
						block: 124_105_968n,
						txIndex: 44,
						logIndex: 237,
						time: 1_790_409_996n,
					},
				}),
				netlistHash: self?.netlistHash,
			},
		]);
	});

	test("carries the chain's step count", async () => {
		// What checkWrapper gives for a wrapper of WRAPS/106 (check-wrapper.test.ts: none exists on
		// chain, so that test makes one from real records): two steps to MINE6/512's gates
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: WRAPS, id: 106n },
			index,
			wrapper: {
				kind: "wrapper",
				pointsTo: [{ processor: WRAPS, id: 106n }],
				finalTargets: [{ processor: MINE6, id: 512n }],
				chainSteps: 2,
			},
		});
		expect(result.result).toMatchObject({
			verdict: "wrapper",
			pointsTo: [{ processor: WRAPS, tokenId: 106n }],
			finalTargets: [{ processor: MINE6, tokenId: 512n }],
			chainSteps: 2,
		});
	});

	test("adds no identical fact to the earliest wrapper", async () => {
		const index = await fixtureIndex();
		const target = { processor: WRAPS, id: 106n };
		const result = originalityVerdict({
			target,
			index,
			wrapper: await wrapperCheck(target),
		});
		expect(result.result).toMatchObject({ verdict: "wrapper" });
		expect(result.facts).toEqual([]);
	});

	test("is can't check when a target is outside the index, never a wrapper of an unnamed circuit", async () => {
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: WRAPS, id: 106n },
			index,
			wrapper: {
				kind: "wrapper",
				pointsTo: [{ processor: MINE6, id: 999_999n }],
				finalTargets: [{ processor: MINE6, id: 999_999n }],
				chainSteps: 1,
			},
		});
		expect(result.result).toEqual({
			verdict: "cant-check",
			reason: "outside-index",
		});
	});
});

describe("REF records beside real gates", () => {
	test("keep the copy rule's verdict and add the borrowed-gates fact", async () => {
		// MINE6/3: 176 NANDs of its own and 2 REFs to P0/1; 2,408 of 2,584 gates are borrowed
		const index = await fixtureIndex();
		const target = { processor: MINE6, id: 3n };
		const result = originalityVerdict({
			target,
			index,
			wrapper: await wrapperCheck(target),
		});
		expect(result.result).toMatchObject({ verdict: "no-earlier-copy" });
		expect(result.facts).toEqual([
			{
				fact: "uses-ref",
				refRecords: 2,
				targets: [
					expect.objectContaining({
						processor: P0,
						tokenId: 1n,
						tapedOutBy: "0x571d447f4f24688ec35ccf07f1d6993655f6af15",
					}),
				],
				borrowedGates: 2408,
				totalGates: 2584,
			},
		]);
	});
});

describe("REF records pointing outside the index", () => {
	test("are can't check, never a fact naming an unknown circuit", async () => {
		// None on chain on 20 November (docs/decisions/2026-11-20-originality-result.md)
		const index = await fixtureIndex();
		const result = originalityVerdict({
			target: { processor: MINE6, id: 3n },
			index,
			wrapper: {
				kind: "uses-ref",
				refRecords: 1,
				targets: [{ processor: MINE6, id: 999_999n }],
				borrowedGates: 10,
				totalGates: 186,
			},
		});
		expect(result.result).toEqual({
			verdict: "cant-check",
			reason: "outside-index",
		});
		expect(result.facts).toEqual([]);
	});
});

describe("a netlist that can't be read", () => {
	test("is can't check with the reason, before any other rule", async () => {
		const index = await fixtureIndex();
		for (const reason of [
			"netlist-unreadable",
			"read-failed",
			"ref-chain-too-long",
		] as const) {
			const result = originalityVerdict({
				target: { processor: MINE6, id: 1008n },
				index,
				wrapper: { kind: "cant-check", reason, detail: "" },
			});
			expect(result.result).toEqual({ verdict: "cant-check", reason });
			expect(result.facts).toEqual([]);
		}
	});
});
