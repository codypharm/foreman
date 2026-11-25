import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseOriginality, serialiseOriginality } from "@foreman/contract";
import {
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
