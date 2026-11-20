import { replayClient } from "@foreman/chain-bnb/fixture";
import { scanTapeOuts } from "@foreman/originality";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import tapeOuts from "@foreman/originality/fixtures/bnb-tape-outs-116150000.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	fillCommitmentTimes,
	fillTapeOutTimes,
	loadCircuitIndex,
	readIndex,
	readMiners,
	saveScan,
} from "./index.ts";
import {
	fixtureIndexedDatabase,
	freshDatabase,
	TEST_DATABASE_URL,
} from "./testing.ts";

// Filling the times of rows saved before migration 004 (docs/decisions/2026-11-20-originality-result.md,
// decision 1). Tape-out times come from the same TapedOut reads as the scan; a commitment's from
// its block. Expected times are the fixtures' own, saved by the scan and the commitment backfill.
const RANGE = { fromBlock: 116_042_002n, toBlock: 116_150_000n };
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

describe.skipIf(!TEST_DATABASE_URL)("filling missing times", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("gives every tape-out saved without a time the time from its TapedOut log", async () => {
		pool = await freshDatabase();
		const scan = await scanTapeOuts(replayClient(tapeOuts), RANGE);
		if (!scan.complete) throw new Error(scan.detail);
		await saveScan(pool, scan);
		await pool.query("update circuits set taped_out_time = null");
		expect(await fillTapeOutTimes(pool, replayClient(tapeOuts))).toEqual({
			filled: 95,
			remaining: 0,
			failed: null,
		});
		expect((await readIndex(pool)).tapeOuts).toEqual(scan.tapeOuts);
	});

	test("stops, leaving the time missing, when the node gives no block time", async () => {
		pool = await freshDatabase();
		const scan = await scanTapeOuts(replayClient(tapeOuts), RANGE);
		if (!scan.complete) throw new Error(scan.detail);
		await saveScan(pool, scan);
		await pool.query("update circuits set taped_out_time = null");
		const noTimes = {
			...tapeOuts,
			calls: tapeOuts.calls.map((c) =>
				c.method === "eth_getLogs"
					? {
							...c,
							result: (c.result as object[]).map((l) => ({
								...l,
								blockTimestamp: undefined,
							})),
						}
					: c,
			),
		};
		expect(await fillTapeOutTimes(pool, replayClient(noTimes))).toEqual({
			filled: 0,
			remaining: 95,
			failed: expect.stringContaining("no block time"),
		});
	});

	test("gives every design commitment saved without a time its block's time", async () => {
		pool = await fixtureIndexedDatabase();
		const before = await readMiners(pool);
		await pool.query("update miners set design_committed_time = null");
		expect((await loadCircuitIndex(pool)).ready).toBe(false);
		expect(await fillCommitmentTimes(pool, replayClient(circuits))).toEqual({
			filled: 7,
			remaining: 0,
			failed: null,
		});
		expect(await readMiners(pool)).toEqual(before);
		expect((await loadCircuitIndex(pool)).ready).toBe(true);
	});

	test("leaves a commitment whose block read failed without a time, never a made-up one", async () => {
		pool = await fixtureIndexedDatabase();
		await pool.query("update miners set design_committed_time = null");
		// MINE6/2683's commitment block, 122,268,369, gets no answer
		const broken = {
			...circuits,
			calls: circuits.calls.filter(
				(c) =>
					!(
						c.method === "eth_getBlockByNumber" &&
						(c.params as unknown[])[0] === "0x749aad1"
					),
			),
		};
		const result = await fillCommitmentTimes(pool, replayClient(broken));
		expect(result).toEqual({
			filled: 6,
			remaining: 1,
			failed: expect.stringContaining("122268369"),
		});
		const left = await pool.query(
			"select processor, id from miners where design_committed_at is not null and design_committed_time is null",
		);
		expect(left.rows).toEqual([{ processor: MINE6, id: "2683" }]);
		expect((await loadCircuitIndex(pool)).ready).toBe(false);
	});
});
