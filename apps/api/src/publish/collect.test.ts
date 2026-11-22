import { replayClient } from "@foreman/chain-bnb/fixture";
import { readStoredResult } from "@foreman/index";
import {
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { refreshResults } from "../results/refresh.ts";
import { circuitsToPublish, storedResultsToPublish } from "./collect.ts";

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

	test("publishes each miner's and listed circuit's stored result, exactly as stored, and skips one with none, never building it (2026-11-21-stored-results.md)", async () => {
		pool = await fixtureIndexedDatabase();
		await list(pool, 1, { processor: P0, tokenId: 6534n });
		// MINE6/1965 is revoked, and the fixture database holds no Revoked event for it: no stored result
		const run = await refreshResults(pool, replayClient(circuits), {
			mode: "full",
			now: 1_795_200_000n,
		});
		if (!run.refreshed) throw new Error("the results didn't build");

		const { results, skipped } = await storedResultsToPublish(pool);
		expect(skipped).toEqual([
			{
				circuit: { processor: MINE6, id: 1965n },
				detail: "no stored result yet: run the results job",
			},
		]);
		expect(results).toHaveLength(16);
		for (const o of results) {
			const stored = await readStoredResult(pool, {
				processor: o.circuit.processor,
				id: o.circuit.tokenId,
			});
			expect(o).toEqual(stored?.originality);
		}
		expect(results.find((o) => o.circuit.tokenId === 6534n)?.scope).toBe(
			"listed",
		);
	});

	test("leaves out a stored result whose circuit is no longer a miner or listed", async () => {
		pool = await fixtureIndexedDatabase();
		await list(pool, 1, { processor: P0, tokenId: 6534n });
		await refreshResults(pool, replayClient(circuits), {
			mode: "full",
			now: 1_795_200_000n,
		});
		await pool.query(
			"update market_listings set open = false, seller = null, processor = null, token_id = null, price_wei = null, fee_bps = null",
		);
		const { results } = await storedResultsToPublish(pool);
		expect(results.map((o) => o.circuit.tokenId)).not.toContain(6534n);
	});
});
