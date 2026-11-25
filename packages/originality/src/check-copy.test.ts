import { describe, expect, test } from "vitest";
import { checkCopy } from "./index.ts";
import { fixtureIndex } from "./testing.ts";

// Real circuits at BNB block 134,673,279 (fixtures/README.md, "Identical circuits" and after).
// Rules: docs/decisions/2026-11-20-copy-and-wrapper-rules.md (decisions 3 and 4) and
// 2026-11-20-verdict-scope-and-earliest-design.md (decisions 4 and 5).
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const WRAPS = "0xc1ae0d87cde4f93bcae38c6d62a269c76d5d3215";
const F441 = "0xf4412c52ec3ddf7caf5f518b6662f77b02bde28e";
const RULES = { sizeFloor: 0 };

describe("checking a circuit for an earlier copy", () => {
	test("calls a miner a copy of an identical circuit taped out earlier on a processor that can't mine", async () => {
		const index = await fixtureIndex();
		const result = checkCopy({ processor: MINE6, id: 1008n }, index, RULES);
		expect(result).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: F441, id: 63n } },
			bytesIdentical: true,
			earlierBy: "tape-out",
			sameAddress: false,
		});
	});

	test("never calls the earliest circuit a copy, and says how many circuits it checked", async () => {
		// P0/1 is the first of three identical 1,204-gate circuits
		const index = await fixtureIndex();
		expect(checkCopy({ processor: P0, id: 1n }, index, RULES)).toEqual({
			kind: "no-earlier-copy",
			circuitsChecked: 33,
			upTo: [{ chainId: 56, block: 134_673_279n }],
		});
	});
});

describe("the earliest proven design is the original", () => {
	// MINE6/2510: commitment 122,730,917, taped out 122,747,227.
	// MINE6/2683: commitment 122,268,369, taped out 127,718,339 (5 million blocks later).
	test("calls the earlier tape-out the copy when the later one committed its design first", async () => {
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: MINE6, id: 2510n }, index, RULES),
		).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: MINE6, id: 2683n } },
			earlierBy: "commitment",
		});
	});

	test("never calls the circuit that committed first a copy, though it was taped out later", async () => {
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: MINE6, id: 2683n }, index, RULES),
		).toMatchObject({
			kind: "no-earlier-copy",
		});
	});
});

describe("what a copy result says", () => {
	test("orders two tape-outs in one block and transaction by log index, and notes the same address", async () => {
		// WRAPS/106 and /109: block 124,105,968, transaction 44, log 237 and 246, one address
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: WRAPS, id: 109n }, index, RULES),
		).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: WRAPS, id: 106n } },
			earlierBy: "tape-out",
			sameAddress: true,
		});
		expect(
			checkCopy({ processor: WRAPS, id: 106n }, index, RULES),
		).toMatchObject({
			kind: "no-earlier-copy",
		});
	});

	test("says when the bytes differ only by swapped inputs, and a commitment decided which is earlier", async () => {
		// MINE6/1570 taped out after /1510 but committed before /1510 was taped out
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: MINE6, id: 1510n }, index, RULES),
		).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: MINE6, id: 1570n } },
			bytesIdentical: false,
			earlierBy: "commitment",
		});
	});

	test("names the earliest identical circuit, not the one just before", async () => {
		// MINE6/967, then /1784, then /2397 (the last two with swapped inputs)
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: MINE6, id: 2397n }, index, RULES),
		).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: MINE6, id: 967n } },
			bytesIdentical: false,
		});
	});
});

describe("the size floor", () => {
	// P0/42, /189, /406, /1251: identical 3-gate circuits, in that order. The real floor is
	// measured from the index (2026-11-20-copy-and-wrapper-rules.md, decision 3); these
	// tests set one either side of 3 gates.
	test("calls an identical circuit below the floor too small to tell, with how many came earlier", async () => {
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: P0, id: 1251n }, index, { sizeFloor: 4 }),
		).toEqual({
			kind: "too-small-to-tell",
			sameAs: 3,
			earliest: expect.objectContaining({
				circuit: { processor: P0, id: 42n },
			}),
			gateCount: 3,
			floor: 4,
		});
	});

	test("calls an identical circuit at the floor a copy", async () => {
		const index = await fixtureIndex();
		expect(
			checkCopy({ processor: P0, id: 1251n }, index, { sizeFloor: 3 }),
		).toMatchObject({
			kind: "copy",
			of: { circuit: { processor: P0, id: 42n } },
		});
	});
});

describe("a circuit Foreman hasn't read", () => {
	test("is can't check, never no earlier copy found", async () => {
		const index = await fixtureIndex();
		expect(checkCopy({ processor: MINE6, id: 999_999n }, index, RULES)).toEqual(
			{
				kind: "cant-check",
				reason: "outside-index",
				detail: expect.stringContaining("134673279"),
			},
		);
	});
});
