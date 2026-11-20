import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-miner-revokes-118590000-118600000.json" with {
	type: "json",
};
import { minerKey, scanMinerRevokes } from "./index.ts";

// Revoked events in blocks 118,590,000 to 118,600,000: two, both in block 118,590,677, the second
// MINE6/1965 (fixtures/README.md). Expected values were read from the saved JSON with Python.
// Rules: docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md, decision 1.
const RANGE = { fromBlock: 118_590_000n, toBlock: 118_600_000n };
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

describe("scanning revoked miners", () => {
	test("gives each revoke's miner, the test vector it failed and where, in chain order", async () => {
		const scan = await scanMinerRevokes(replayClient(fixture), RANGE);
		expect(scan).toEqual({
			complete: true,
			upToBlock: 118_600_000n,
			revokes: [
				{
					key: "0x62cd3805221fffe757a9ffd418f1646ec228bf22670fdb39d3531bbf6a2b99d7",
					vectorIndex: 140,
					revokedAt: { block: 118_590_677n, txIndex: 1, logIndex: 2 },
				},
				{
					key: minerKey({ processor: MINE6, id: 1965n }),
					vectorIndex: 140,
					revokedAt: { block: 118_590_677n, txIndex: 2, logIndex: 5 },
				},
			],
		});
	});

	test("a failed read is a clear error naming the blocks, never no revokes", async () => {
		const scan = await scanMinerRevokes(
			replayClient({ ...fixture, calls: [] }),
			RANGE,
		);
		expect(scan).toEqual({
			complete: false,
			reason: "read-failed",
			detail: expect.stringContaining("blocks 118590000 to 118600000"),
		});
	});
});
