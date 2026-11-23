import type { CircuitRef, Originality } from "@foreman/contract";
import { parseAddress, parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import { changeFingerprint } from "./fingerprint.ts";

// What counts as a change (docs/decisions/2026-11-21-publish-job.md, decision 6): a circuit is
// published again only when its fingerprint differs from the one published last.

const PROCESSOR = parseAddress(
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
	"processor",
);
const HASH = parseHex32(`0x${"ab".repeat(32)}`, "hash");
const OTHER_HASH = parseHex32(`0x${"cd".repeat(32)}`, "hash");

function circuit(id: bigint, block: bigint): CircuitRef {
	return {
		chainId: 56,
		processor: PROCESSOR,
		tokenId: id,
		tapedOutAt: { block, txIndex: 0, logIndex: 0, time: 1_790_000_000n },
		tapedOutBy: parseAddress(`0x${"11".repeat(20)}`, "by"),
		designCommittedAt: null,
	};
}

const COPY: Originality = {
	circuit: circuit(17_663n, 134_500_000n),
	scope: "miner",
	result: {
		verdict: "copy",
		of: circuit(12_000n, 134_400_000n),
		netlistHash: HASH,
		bytesIdentical: true,
		earlierBy: "tape-out",
	},
	facts: [
		{ fact: "design-bonus", holds: false, bonus: 0n },
		{ fact: "design-shared", miners: 3 },
		{
			fact: "can-mine",
			state: "stopped",
			stoppedAt: 134_550_000n,
			canStartFrom: 134_551_200n,
		},
	],
	occc: { status: "not-checked" },
	index: {
		circuitsChecked: 41_203n,
		upToBlock: { chainId: 56, block: 134_600_000n },
	},
	ruleVersion: "hash 2026-11-20, floor 4, chain 10",
};

describe("the change fingerprint", () => {
	test("ignores a moved stop block, a new index block and changed counts", () => {
		const later: Originality = {
			...COPY,
			facts: [
				{ fact: "design-bonus", holds: false, bonus: 0n },
				{ fact: "design-shared", miners: 4 },
				{
					fact: "can-mine",
					state: "stopped",
					stoppedAt: 134_700_000n,
					canStartFrom: 134_701_200n,
				},
			],
			index: {
				circuitsChecked: 41_900n,
				upToBlock: { chainId: 56, block: 134_800_000n },
			},
		};
		expect(changeFingerprint(later)).toBe(changeFingerprint(COPY));
	});

	const withCanMine = (
		o: Originality,
		canMine: Originality["facts"][number],
	): Originality => ({
		...o,
		facts: [...o.facts.filter((f) => f.fact !== "can-mine"), canMine],
	});
	const WRAPPER: Originality = {
		...COPY,
		scope: "listed",
		result: {
			verdict: "wrapper",
			pointsTo: [circuit(100n, 134_000_000n), circuit(101n, 134_000_001n)],
			finalTargets: [circuit(90n, 133_900_000n)],
			chainSteps: 2,
		},
		facts: [
			{
				fact: "can-mine",
				state: "cant-mine",
				reasons: [{ reason: "uses-ref" }],
			},
		],
	};

	test.each<[string, Originality, Originality]>([
		[
			"a different verdict kind",
			COPY,
			{ ...COPY, result: { verdict: "no-earlier-copy", netlistHash: HASH } },
		],
		[
			"a copy of a different circuit",
			COPY,
			{
				...COPY,
				result: { ...COPY.result, of: circuit(12_001n, 134_400_000n) },
			} as Originality,
		],
		[
			"a different netlist hash",
			COPY,
			{
				...COPY,
				result: { ...COPY.result, netlistHash: OTHER_HASH },
			} as Originality,
		],
		[
			"a wrapper with a different target",
			WRAPPER,
			{
				...WRAPPER,
				result: {
					...WRAPPER.result,
					pointsTo: [circuit(100n, 134_000_000n), circuit(102n, 134_000_002n)],
				},
			} as Originality,
		],
		[
			"a wrapper ending somewhere else",
			WRAPPER,
			{
				...WRAPPER,
				result: {
					...WRAPPER.result,
					finalTargets: [circuit(91n, 133_900_000n)],
				},
			} as Originality,
		],
		[
			"a different reason it can't be checked",
			{
				...COPY,
				result: { verdict: "cant-check", reason: "netlist-unreadable" },
			},
			{ ...COPY, result: { verdict: "cant-check", reason: "outside-index" } },
		],
		[
			"a different can-mine state",
			COPY,
			withCanMine(COPY, { fact: "can-mine", state: "mining" }),
		],
		[
			"another reason it can't mine",
			WRAPPER,
			withCanMine(WRAPPER, {
				fact: "can-mine",
				state: "cant-mine",
				reasons: [{ reason: "processor-not-eligible" }, { reason: "uses-ref" }],
			}),
		],
	])("changes with %s", (_why, before, after) => {
		expect(changeFingerprint(after)).not.toBe(changeFingerprint(before));
	});

	test("ignores the order of the reasons and of a wrapper's targets", () => {
		const reordered: Originality = {
			...WRAPPER,
			result: {
				...WRAPPER.result,
				pointsTo: [circuit(101n, 134_000_001n), circuit(100n, 134_000_000n)],
			} as Originality["result"],
		};
		const two = (
			reasons: { reason: "uses-ref" | "processor-not-eligible" }[],
		) =>
			withCanMine(WRAPPER, { fact: "can-mine", state: "cant-mine", reasons });
		expect(changeFingerprint(reordered)).toBe(changeFingerprint(WRAPPER));
		expect(
			changeFingerprint(
				two([{ reason: "uses-ref" }, { reason: "processor-not-eligible" }]),
			),
		).toBe(
			changeFingerprint(
				two([{ reason: "processor-not-eligible" }, { reason: "uses-ref" }]),
			),
		);
	});
});
