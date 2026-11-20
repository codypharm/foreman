import { replayClient } from "@foreman/chain-bnb/fixture";
import { minerKey, scanMinerRevokes } from "@foreman/originality";
import revokes from "@foreman/originality/fixtures/bnb-miner-revokes-118590000-118600000.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { readMiners, saveMinerRevokes } from "./index.ts";
import { fixtureIndexedDatabase, TEST_DATABASE_URL } from "./testing.ts";

// Revoked events in blocks 118,590,000 to 118,600,000: MINE6/1965 and one miner that isn't among
// the originality fixture's 16 (packages/originality/fixtures/README.md). Rules:
// docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md, decision 1.
const RANGE = { fromBlock: 118_590_000n, toBlock: 118_600_000n };
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const MINE6_1965 = minerKey({ processor: MINE6, id: 1965n });

async function revokeScan() {
	const scan = await scanMinerRevokes(replayClient(revokes), RANGE);
	if (!scan.complete) throw new Error(scan.detail);
	return scan;
}

describe.skipIf(!TEST_DATABASE_URL)("saving revoked miners", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("keeps each revoked miner's test vector and where it was revoked", async () => {
		pool = await fixtureIndexedDatabase();
		const scan = await revokeScan();
		// Only MINE6/1965 is among the fixture's miners
		await saveMinerRevokes(pool, {
			...scan,
			revokes: scan.revokes.filter((r) => r.key === MINE6_1965),
		});
		const { miners, revokesUpToBlock } = await readMiners(pool);
		expect(revokesUpToBlock).toBe(118_600_000n);
		expect(miners.find((m) => m.key === MINE6_1965)?.revoked).toEqual({
			vectorIndex: 140,
			revokedAt: { block: 118_590_677n, txIndex: 2, logIndex: 5 },
		});
		expect(miners.filter((m) => m.revoked !== null)).toHaveLength(1);
	});

	test("refuses a revoke for a miner the index doesn't have, and saves none of the scan", async () => {
		pool = await fixtureIndexedDatabase();
		await expect(saveMinerRevokes(pool, await revokeScan())).rejects.toThrow(
			"0x62cd3805221fffe757a9ffd418f1646ec228bf22670fdb39d3531bbf6a2b99d7",
		);
		const { miners, revokesUpToBlock } = await readMiners(pool);
		expect(revokesUpToBlock).toBeNull();
		expect(miners.filter((m) => m.revoked !== null)).toHaveLength(0);
	});
});
