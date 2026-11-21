import { describe, expect, test } from "vitest";
import { parseOriginality, serialiseOriginality } from "./index.ts";

// Originality on the wire (docs/data-contract.md, "Originality"): the JSON the API sends and the
// results contract logs (docs/decisions/2026-11-21-results-contract.md). The parser refuses a result
// the data contract's rules say can't exist, so nothing malformed is shown or published.

const PROCESSOR = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";
const HASH = `0x${"ab".repeat(32)}`;

/** A circuit taped out at `block`, optionally with an accepted design commitment. */
function circuit(
	tokenId: string,
	block: string,
	position: { txIndex?: number; logIndex?: number } = {},
	committed: string | null = null,
) {
	return {
		chainId: 56,
		processor: PROCESSOR,
		tokenId,
		tapedOutAt: {
			block,
			txIndex: position.txIndex ?? 3,
			logIndex: position.logIndex ?? 7,
			time: "1795000000",
		},
		tapedOutBy: `0x${"12".repeat(20)}`,
		designCommittedAt: committed
			? { block: committed, time: "1794990000" }
			: null,
	};
}

const MINING = { fact: "can-mine", state: "mining" };

function wire(overrides: Record<string, unknown> = {}) {
	return {
		circuit: circuit("17663", "134500000"),
		scope: "miner",
		result: { verdict: "no-earlier-copy", netlistHash: HASH },
		facts: [MINING, { fact: "design-bonus", holds: true, bonus: "248" }],
		occc: { status: "not-checked" },
		index: {
			circuitsChecked: "41203",
			upToBlock: { chainId: 56, block: "134600000" },
		},
		ruleVersion: "hash 2026-11-20, floor 4, chain 10",
		...overrides,
	};
}

const COPY = {
	verdict: "copy",
	of: circuit("12000", "134400000"),
	netlistHash: HASH,
	bytesIdentical: false,
	earlierBy: "tape-out",
};
const WRAPPER = {
	verdict: "wrapper",
	pointsTo: [circuit("100", "134000000")],
	finalTargets: [circuit("90", "133900000")],
	chainSteps: 2,
};

describe("an Originality on the wire", () => {
	test.each([
		["no earlier copy found, on a miner", wire()],
		[
			"a copy, with the tape-out address fact",
			wire({
				result: COPY,
				facts: [MINING, { fact: "tape-out-address", same: true }],
			}),
		],
		[
			"too small to tell",
			wire({
				result: {
					verdict: "too-small-to-tell",
					sameAs: 3020,
					earliest: circuit("50", "130000000"),
					netlistHash: HASH,
					gateCount: 3,
					floor: 4,
				},
				facts: [MINING, { fact: "design-shared", miners: 3021 }],
			}),
		],
		[
			"a wrapper on a listed circuit that can't mine",
			wire({
				scope: "listed",
				result: WRAPPER,
				facts: [
					{
						fact: "can-mine",
						state: "cant-mine",
						reasons: [{ reason: "uses-ref" }],
					},
				],
			}),
		],
		[
			"can't check, a stopped miner",
			wire({
				result: { verdict: "cant-check", reason: "netlist-unreadable" },
				facts: [
					{
						fact: "can-mine",
						state: "stopped",
						stoppedAt: "134590000",
						canStartFrom: "134591200",
					},
				],
			}),
		],
		[
			"a revoked miner, OCCC official",
			wire({
				facts: [
					{
						fact: "can-mine",
						state: "cant-mine",
						reasons: [
							{
								reason: "failed-test-vector",
								taskId: 151,
								vectorIndex: 9,
								block: "134550000",
							},
						],
					},
				],
				occc: { status: "official", collection: `0x${"34".repeat(20)}` },
			}),
		],
	])("reads back unchanged: %s", (_name, original) => {
		const parsed = parseOriginality(original, "originality");
		const sent = JSON.parse(
			JSON.stringify(serialiseOriginality(parsed, "originality")),
		);
		expect(sent).toEqual(original);
		expect(parseOriginality(sent, "originality")).toEqual(parsed);
	});

	test("a copy whose earlier circuit has a design commitment before its own tape-out", () => {
		// Circuit 12000 was taped out after this one, but its accepted commitment is earlier
		const result = {
			...COPY,
			of: circuit("12000", "134600001", {}, "134400000"),
			earlierBy: "commitment",
		};
		expect(
			parseOriginality(wire({ result, facts: [MINING] }), "o").result,
		).toMatchObject({ verdict: "copy", earlierBy: "commitment" });
	});

	test.each([
		["no can-mine fact", { facts: [] }, "o.facts"],
		["two can-mine facts", { facts: [MINING, MINING] }, "o.facts"],
		[
			"can't mine with no reason",
			{ facts: [{ fact: "can-mine", state: "cant-mine", reasons: [] }] },
			"o.facts[0].reasons",
		],
		[
			"a stopped miner that can start again at the wrong block",
			{
				facts: [
					{
						fact: "can-mine",
						state: "stopped",
						stoppedAt: "134590000",
						canStartFrom: "134590001",
					},
				],
			},
			"o.facts[0].canStartFrom",
		],
		[
			"a design shared by one miner",
			{ facts: [MINING, { fact: "design-shared", miners: 1 }] },
			"o.facts[1].miners",
		],
		["a design bonus on a listed circuit", { scope: "listed" }, "o.facts[1]"],
		[
			"REF records on a miner",
			{
				facts: [
					MINING,
					{
						fact: "uses-ref",
						refRecords: 1,
						targets: [circuit("100", "134000000")],
						borrowedGates: 1204,
						totalGates: 1209,
					},
				],
			},
			"o.facts[1]",
		],
		["a wrapper on a miner", { result: WRAPPER, facts: [MINING] }, "o.result"],
		[
			"a wrapper chain longer than 10 steps",
			{
				scope: "listed",
				result: { ...WRAPPER, chainSteps: 11 },
				facts: [MINING],
			},
			"o.result.chainSteps",
		],
		[
			"a copy of a later circuit",
			{
				result: { ...COPY, of: circuit("12000", "134500001") },
				facts: [MINING],
			},
			"o.result.of",
		],
		[
			"a copy of a circuit in the same block but a later transaction",
			{
				result: { ...COPY, of: circuit("12000", "134500000", { txIndex: 4 }) },
				facts: [MINING],
			},
			"o.result.of",
		],
		[
			"too small to tell at the floor",
			{
				result: {
					verdict: "too-small-to-tell",
					sameAs: 1,
					earliest: circuit("50", "130000000"),
					netlistHash: HASH,
					gateCount: 4,
					floor: 4,
				},
			},
			"o.result.gateCount",
		],
		[
			"an index of no circuits",
			{
				index: {
					circuitsChecked: "0",
					upToBlock: { chainId: 56, block: "134600000" },
				},
			},
			"o.index.circuitsChecked",
		],
		["no rule version", { ruleVersion: "" }, "o.ruleVersion"],
		[
			"an unknown verdict",
			{ result: { verdict: "original" } },
			"o.result.verdict",
		],
	])("is refused with %s", (_why, overrides, field) => {
		expect(() => parseOriginality(wire(overrides), "o")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});
});
