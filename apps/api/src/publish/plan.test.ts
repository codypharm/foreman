import type { CircuitRef, Originality } from "@foreman/contract";
import { parseAddress, parseHex32, parseOriginality } from "@foreman/contract";
import type { PublishedRow } from "@foreman/index";
import { minerKey } from "@foreman/originality";
import { hexToString, keccak256 } from "viem";
import { describe, expect, test } from "vitest";
import { changeFingerprint } from "./fingerprint.ts";
import { planPublish, shortVerdict } from "./plan.ts";

// The plan (docs/decisions/2026-11-21-publish-job.md, decisions 4 and 6): every result whose
// fingerprint differs from its last publish, with the exact bytes the contract logs and hashes.

const MINE6 = parseAddress(
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
	"processor",
);
const HASH = parseHex32(`0x${"ab".repeat(32)}`, "hash");

function ref(id: bigint): CircuitRef {
	return {
		chainId: 56,
		processor: MINE6,
		tokenId: id,
		tapedOutAt: {
			block: 134_000_000n + id,
			txIndex: 0,
			logIndex: 0,
			time: 1_790_000_000n,
		},
		tapedOutBy: parseAddress(`0x${"11".repeat(20)}`, "by"),
		designCommittedAt: null,
	};
}

function result(id: bigint, canMine: "mining" | "not-started"): Originality {
	return {
		circuit: ref(id),
		scope: "miner",
		result: { verdict: "no-earlier-copy", netlistHash: HASH },
		facts: [{ fact: "can-mine", state: canMine }],
		occc: { status: "not-checked" },
		index: {
			circuitsChecked: 41_203n,
			upToBlock: { chainId: 56, block: 134_600_000n },
		},
		ruleVersion: "hash 2026-11-20, floor 4, chain 10",
	};
}

function published(o: Originality): PublishedRow {
	return {
		key: minerKey({ processor: o.circuit.processor, id: o.circuit.tokenId }),
		processor: o.circuit.processor,
		id: o.circuit.tokenId,
		...shortVerdict(o),
		fingerprint: changeFingerprint(o),
		resultHash: parseHex32(`0x${"ee".repeat(32)}`, "hash"),
		indexBlock: 134_500_000n,
		tx: parseHex32(`0x${"01".repeat(32)}`, "tx"),
		block: 1_000n,
	};
}

describe("the publish plan", () => {
	test("holds new and changed circuits, never unchanged ones", () => {
		const unchanged = result(1n, "mining");
		const changed = result(2n, "mining");
		const fresh = result(3n, "mining");
		const before = new Map(
			[unchanged, result(2n, "not-started")].map((o) => {
				const row = published(o);
				return [row.key, row];
			}),
		);
		const plan = planPublish([unchanged, changed, fresh], before);
		expect(plan.entries.map((e) => e.id)).toEqual([2n, 3n]);
		expect(plan.unchanged).toBe(1);
	});

	test("an entry carries the miner key, the short verdict and the exact bytes and their hash", () => {
		const o = result(7n, "not-started");
		const [entry] = planPublish([o], new Map()).entries;
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			key: minerKey({ processor: MINE6, id: 7n }),
			processor: MINE6,
			id: 7n,
			kind: 1,
			canMine: 4,
			indexBlock: 134_600_000n,
			fingerprint: changeFingerprint(o),
		});
		expect(entry.resultHash).toBe(keccak256(entry.result));
		expect(
			parseOriginality(JSON.parse(hexToString(entry.result)), "logged"),
		).toEqual(o);
	});

	test.each<[Originality["result"], number]>([
		[{ verdict: "no-earlier-copy", netlistHash: HASH }, 1],
		[
			{
				verdict: "copy",
				of: ref(1n),
				netlistHash: HASH,
				bytesIdentical: true,
				earlierBy: "tape-out",
			},
			2,
		],
		[
			{
				verdict: "too-small-to-tell",
				sameAs: 2,
				earliest: ref(1n),
				netlistHash: HASH,
				gateCount: 3,
				floor: 4,
			},
			3,
		],
		[
			{
				verdict: "wrapper",
				pointsTo: [ref(1n)],
				finalTargets: [ref(1n)],
				chainSteps: 1,
			},
			4,
		],
		[{ verdict: "cant-check", reason: "netlist-unreadable" }, 5],
	])("the contract's kind for %o is %i", (verdict, kind) => {
		expect(
			shortVerdict({ ...result(9n, "mining"), result: verdict }).kind,
		).toBe(kind);
	});

	test.each<[Originality["facts"][number], number]>([
		[{ fact: "can-mine", state: "mining" }, 1],
		[
			{
				fact: "can-mine",
				state: "cant-mine",
				reasons: [{ reason: "processor-not-eligible" }],
			},
			2,
		],
		[
			{
				fact: "can-mine",
				state: "stopped",
				stoppedAt: 1n,
				canStartFrom: 1_201n,
			},
			3,
		],
		[{ fact: "can-mine", state: "not-started" }, 4],
	])("the contract's can-mine code for %o is %i", (fact, code) => {
		expect(
			shortVerdict({ ...result(9n, "mining"), facts: [fact] }).canMine,
		).toBe(code);
	});
});
