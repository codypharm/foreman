import type { Originality } from "@foreman/contract";
import { parseAddress, parseHex32 } from "@foreman/contract";
import { encodeFunctionData } from "viem";
import { describe, expect, test } from "vitest";
import { foremanResultsAbi } from "./abi.ts";
import {
	batchEntries,
	MAX_BATCH_CALLDATA,
	publishCalldataSize,
} from "./batch.ts";
import { type PlanEntry, planEntry } from "./plan.ts";

// Batches by count and by size: X Layer's node refuses a transaction over 131,072 bytes, which a
// batch of 100 large results passed on the testnet (batch 41, 134,869 bytes, 21 Nov 2026).

const MINE6 = parseAddress(
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
	"processor",
);

/** A real-shaped result whose logged JSON grows with `padding` (a longer rule version). */
function entry(id: bigint, padding: number): PlanEntry {
	const o: Originality = {
		circuit: {
			chainId: 56,
			processor: MINE6,
			tokenId: id,
			tapedOutAt: { block: 134_000_000n, txIndex: 0, logIndex: 0, time: 1n },
			tapedOutBy: parseAddress(`0x${"11".repeat(20)}`, "by"),
			designCommittedAt: null,
		},
		scope: "miner",
		result: {
			verdict: "no-earlier-copy",
			netlistHash: parseHex32(`0x${"ab".repeat(32)}`, "hash"),
		},
		facts: [{ fact: "can-mine", state: "mining" }],
		occc: { status: "not-checked" },
		index: {
			circuitsChecked: 41_203n,
			upToBlock: { chainId: 56, block: 134_600_000n },
		},
		ruleVersion: `hash 2026-11-20, floor 4, chain 10${" ".repeat(padding)}`,
	};
	return planEntry(o);
}

const encoded = (batch: PlanEntry[]) =>
	(encodeFunctionData({
		abi: foremanResultsAbi,
		functionName: "publish",
		args: [
			batch.map((e) => ({
				processor: e.processor,
				circuitId: e.id,
				kind: e.kind,
				canMine: e.canMine,
				indexBlock: e.indexBlock,
				result: e.result,
			})),
		],
	}).length -
		2) /
	2;

describe("batching", () => {
	test("the calldata size is exactly what the contract call encodes to", () => {
		const batch = [entry(1n, 0), entry(2n, 33), entry(3n, 700)];
		expect(publishCalldataSize(batch)).toBe(encoded(batch));
	});

	test("large results go in smaller batches, each under the size limit, in order, none lost", () => {
		// 1,600-byte results: 100 of them would be about 186,000 bytes
		const entries = Array.from({ length: 250 }, (_, i) =>
			entry(BigInt(i + 1), 1_400),
		);
		const batches = batchEntries(entries, { maxEntries: 100 });
		for (const b of batches) {
			expect(encoded(b)).toBeLessThanOrEqual(MAX_BATCH_CALLDATA);
		}
		expect(batches.length).toBeGreaterThan(3);
		expect(batches.flat()).toEqual(entries);
	});

	test("small results still stop at the entry count", () => {
		const entries = Array.from({ length: 250 }, (_, i) =>
			entry(BigInt(i + 1), 0),
		);
		expect(
			batchEntries(entries, { maxEntries: 100 }).map((b) => b.length),
		).toEqual([100, 100, 50]);
	});

	test("a single result too large for any transaction is refused, never sent", () => {
		expect(() =>
			batchEntries([entry(1n, MAX_BATCH_CALLDATA)], { maxEntries: 100 }),
		).toThrow(/too large/);
	});
});
