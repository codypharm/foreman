import type { Originality } from "@foreman/contract";
import { parseAddress, parseHex32 } from "@foreman/contract";
import { stringToHex } from "viem";
import { describe, expect, test } from "vitest";
import { planEntry } from "./plan.ts";
import {
	type PlanFile,
	parsePlanFile,
	serialisePlanFile,
} from "./plan-file.ts";

// The dry run's plan file (docs/decisions/2026-11-21-publish-job.md, decision 4). `--send` sends
// exactly what it holds, re-deriving every entry's key, short verdict and hash from its logged bytes
// so the stored verdict and the log can't disagree.

const MINE6 = parseAddress(
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
	"processor",
);
const HASH = parseHex32(`0x${"ab".repeat(32)}`, "hash");

function result(id: bigint, block = 134_600_000n): Originality {
	return {
		circuit: {
			chainId: 56,
			processor: MINE6,
			tokenId: id,
			tapedOutAt: {
				block: 134_000_000n,
				txIndex: 0,
				logIndex: 0,
				time: 1_790_000_000n,
			},
			tapedOutBy: parseAddress(`0x${"11".repeat(20)}`, "by"),
			designCommittedAt: null,
		},
		scope: "miner",
		result: { verdict: "no-earlier-copy", netlistHash: HASH },
		facts: [{ fact: "can-mine", state: "mining" }],
		occc: { status: "not-checked" },
		index: {
			circuitsChecked: 41_203n,
			upToBlock: { chainId: 56, block },
		},
		ruleVersion: "hash 2026-11-20, floor 4, chain 10",
	};
}

const FILE: PlanFile = {
	chainId: 1952,
	contract: null,
	indexBlock: 134_600_000n,
	unchanged: 3,
	skipped: [
		{ circuit: { processor: MINE6, id: 1965n }, detail: "revoked, no event" },
	],
	gas: null,
	entries: [planEntry(result(1n)), planEntry(result(2n))],
};

const viaJson = (f: PlanFile) =>
	JSON.parse(JSON.stringify(serialisePlanFile(f)));

describe("the plan file", () => {
	test("reads back exactly what was written", () => {
		expect(parsePlanFile(viaJson(FILE))).toEqual(FILE);
	});

	test("says how many of each verdict it holds", () => {
		expect(viaJson(FILE).byVerdict).toEqual({ "no-earlier-copy": 2 });
	});

	test("refuses an entry whose bytes are not a result", () => {
		const wire = viaJson(FILE);
		wire.entries[1].result = stringToHex('{"verdict":"original"}');
		expect(() => parsePlanFile(wire)).toThrow(/entries\[1\]/);
	});

	test("keeps entries read at different blocks, each with its own: stored results between full rebuilds (2026-11-22-publish-from-stored-results.md)", () => {
		const mixed: PlanFile = {
			...FILE,
			entries: [planEntry(result(1n)), planEntry(result(2n, 134_500_000n))],
		};
		const read = parsePlanFile(viaJson(mixed));
		expect(read).toEqual(mixed);
		expect(read.entries.map((e) => e.indexBlock)).toEqual([
			134_600_000n,
			134_500_000n,
		]);
	});

	test("refuses an entry read after the plan's newest block", () => {
		const wire = viaJson({
			...FILE,
			entries: [planEntry(result(1n)), planEntry(result(2n, 134_700_000n))],
		});
		expect(() => parsePlanFile(wire)).toThrow(/entries\[1\]/);
	});

	test("refuses a circuit planned twice", () => {
		const wire = viaJson({
			...FILE,
			entries: [planEntry(result(1n)), planEntry(result(1n))],
		});
		expect(() => parsePlanFile(wire)).toThrow(/entries\[1\]/);
	});
});
