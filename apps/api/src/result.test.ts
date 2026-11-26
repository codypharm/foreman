import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseOriginality, serialiseOriginality } from "@foreman/contract";
import {
	fabxIndexedDatabase,
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { buildResult, loadResultContext } from "./result.ts";

// One circuit's complete result from the stored index, with its can-mine facts read from the
// mining contract at the index's block. The fixture's 33 circuits, indexed up to block 134,673,279
// (packages/originality/fixtures/README.md, which states each case).

const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const INDEX_BLOCK = 134_673_279n;

describe.skipIf(!TEST_DATABASE_URL)("one circuit's result", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	async function context() {
		pool = await fixtureIndexedDatabase();
		const loaded = await loadResultContext(pool, replayClient(circuits));
		if (!loaded.ready) throw new Error(loaded.detail);
		return loaded.context;
	}

	test("a miner copied from a design committed earlier: copy, with the contract's facts and the index's block", async () => {
		const read = await buildResult(
			await context(),
			{ processor: MINE6, id: 2510n },
			"miner",
		);
		if (!read.ok) throw new Error(read.detail);
		const o = read.originality;
		expect(o.scope).toBe("miner");
		expect(o.result).toMatchObject({
			verdict: "copy",
			of: { tokenId: 2683n },
			earlierBy: "commitment",
		});
		expect(o.facts[0]?.fact).toBe("design-bonus");
		expect(o.facts.filter((f) => f.fact === "can-mine")).toHaveLength(1);
		expect(o.index.upTo).toEqual([{ chainId: 56, block: INDEX_BLOCK }]);
		expect(parseOriginality(serialiseOriginality(o, "o"), "o")).toEqual(o);
	});

	test("a listed wrapper on a processor that can't mine: wrapper, can't mine for both reasons", async () => {
		const read = await buildResult(
			await context(),
			{ processor: P0, id: 6534n },
			"listed",
		);
		if (!read.ok) throw new Error(read.detail);
		expect(read.originality.result).toMatchObject({
			verdict: "wrapper",
			pointsTo: [{ processor: P0, tokenId: 5388n }],
			chainSteps: 1,
		});
		expect(read.originality.facts.at(-1)).toEqual({
			fact: "can-mine",
			state: "cant-mine",
			reasons: [{ reason: "processor-not-eligible" }, { reason: "uses-ref" }],
		});
	});

	test("a revoked miner whose Revoked event the index lacks is an error, never a result", async () => {
		const read = await buildResult(
			await context(),
			{ processor: MINE6, id: 1965n },
			"miner",
		);
		expect(read).toMatchObject({ ok: false });
	});

	test("a circuit outside the index is an error, never a result", async () => {
		const read = await buildResult(
			await context(),
			{ processor: MINE6, id: 999_999n },
			"listed",
		);
		expect(read).toEqual({
			ok: false,
			detail: `${MINE6}/999999 is outside the index`,
		});
	});
});

// FabX circuits beside the fixture's BNB Chain index, at X Layer block 76,847,895
// (@foreman/index/testing, fabxIndexedDatabase; 2026-11-25-fabx-can-mine.md).
const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";
const FABX_MINING = {
	chainId: 196,
	contract: "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265",
};

describe.skipIf(!TEST_DATABASE_URL)("a FabX circuit's result", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	async function context() {
		pool = await fabxIndexedDatabase();
		// The BNB Chain node is only replayed: a FabX result reads nothing from it
		const loaded = await loadResultContext(pool, replayClient(circuits));
		if (!loaded.ready) throw new Error(loaded.detail);
		return loaded.context;
	}

	test("a stopped FabX miner: copy of FabX #24, stopped at its X Layer block with no restart block, in FabX's mining contract", async () => {
		const read = await buildResult(
			await context(),
			{ processor: FABX, id: 66n },
			"miner",
		);
		if (!read.ok) throw new Error(read.detail);
		const o = read.originality;
		expect(o.circuit).toMatchObject({ chainId: 196, tokenId: 66n });
		expect(o.mining).toEqual(FABX_MINING);
		expect(o.result).toMatchObject({
			verdict: "copy",
			of: { chainId: 196, tokenId: 24n },
			earlierBy: "tape-out",
			bytesIdentical: true,
		});
		expect(o.facts.some((f) => f.fact === "design-bonus")).toBe(false);
		expect(o.facts.at(-1)).toEqual({
			fact: "can-mine",
			state: "stopped",
			stoppedAt: 74_423_691n,
			canStartFrom: null,
		});
		expect(o.index.upTo).toEqual([
			{ chainId: 56, block: INDEX_BLOCK },
			{ chainId: 196, block: 76_847_895n },
		]);
		expect(o.ruleVersion).toBe(
			"hash 2026-11-20, floor 4, chain 10, BNB Chain and X Layer by second, FabX commitments by event",
		);
		expect(parseOriginality(serialiseOriginality(o, "o"), "o")).toEqual(o);
	});

	test("a FabX wrapper that isn't a miner: wrapper of FabX #4206 from the stored netlists, can't mine, no mining contract", async () => {
		const read = await buildResult(
			await context(),
			{ processor: FABX, id: 6147n },
			"pasted",
		);
		if (!read.ok) throw new Error(read.detail);
		const o = read.originality;
		expect(o.mining).toBeNull();
		expect(o.result).toMatchObject({
			verdict: "wrapper",
			pointsTo: [{ chainId: 196, tokenId: 4206n }],
			finalTargets: [{ chainId: 196, tokenId: 4206n }],
			chainSteps: 1,
		});
		expect(o.facts.at(-1)).toEqual({
			fact: "can-mine",
			state: "cant-mine",
			reasons: [{ reason: "uses-ref" }],
		});
		expect(parseOriginality(serialiseOriginality(o, "o"), "o")).toEqual(o);
	});

	test("a FabX miner is mining now when FabX reports it active", async () => {
		const read = await buildResult(
			await context(),
			{ processor: FABX, id: 24n },
			"miner",
		);
		if (!read.ok) throw new Error(read.detail);
		expect(read.originality.mining).toEqual(FABX_MINING);
		expect(read.originality.result.verdict).toBe("no-earlier-copy");
		expect(read.originality.facts.at(-1)).toEqual({
			fact: "can-mine",
			state: "mining",
		});
	});
});
