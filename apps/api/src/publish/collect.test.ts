import { replayClient } from "@foreman/chain-bnb/fixture";
import {
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { loadResultContext } from "../result.ts";
import { circuitsToPublish, collectResults } from "./collect.ts";

// Which circuits get a result (docs/decisions/2026-11-21-publish-job.md, "Which circuits"): every
// miner, and every circuit with an open listing that isn't a miner. The fixture database has 16
// miners; the listings are made up.

const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const SELLER = `0x${"22".repeat(20)}`;

async function list(
	pool: pg.Pool,
	id: number,
	listing: { processor: string; tokenId: bigint } | null,
) {
	await pool.query(
		`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
		   price_wei, fee_bps)
		 values ($1, 134673279, $2, $3, $4, $5, $6, $7)`,
		listing
			? [
					id,
					true,
					SELLER,
					listing.processor,
					listing.tokenId.toString(),
					"1000",
					100,
				]
			: [id, false, null, null, null, null, null],
	);
}

describe.skipIf(!TEST_DATABASE_URL)("the circuits to publish", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("every miner, and each open listing that isn't a miner, once", async () => {
		pool = await fixtureIndexedDatabase();
		await list(pool, 1, { processor: P0, tokenId: 6534n });
		await list(pool, 2, { processor: MINE6, tokenId: 153n }); // a miner: stays "miner"
		await list(pool, 3, { processor: P0, tokenId: 6534n }); // listed twice: once
		await list(pool, 4, null); // closed

		const targets = await circuitsToPublish(pool);
		expect(targets.filter((t) => t.scope === "miner")).toHaveLength(16);
		expect(targets.filter((t) => t.scope === "listed")).toEqual([
			{ circuit: { processor: P0, id: 6534n }, scope: "listed" },
		]);
	});

	test("a circuit whose result can't be built is skipped with its reason, never published", async () => {
		pool = await fixtureIndexedDatabase();
		await list(pool, 1, { processor: P0, tokenId: 6534n });
		const loaded = await loadResultContext(pool, replayClient(circuits));
		if (!loaded.ready) throw new Error(loaded.detail);

		const { results, skipped } = await collectResults(
			loaded.context,
			await circuitsToPublish(pool),
			{ concurrency: 4 },
		);
		// MINE6/1965 is revoked, and the fixture database holds no Revoked event for it
		expect(skipped).toEqual([
			{
				circuit: { processor: MINE6, id: 1965n },
				detail: expect.stringContaining("revoked"),
			},
		]);
		expect(results).toHaveLength(16);
		expect(results.find((o) => o.circuit.tokenId === 6534n)?.scope).toBe(
			"listed",
		);
	});
});
