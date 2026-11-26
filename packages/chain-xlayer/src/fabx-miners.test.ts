import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/fabx-miners-76847895.json" with {
	type: "json",
};
import { FABX_MINER_FIXTURE_IDS, readFabxMiners } from "./fabx-miners.ts";

// getMiner on FabX's mining contract at X Layer block 76,847,895, recorded on 25 Nov 2026.
const blockNumber = 76_847_895n;

describe("reading FabX's miner records", () => {
	test("gives each miner's status, stop block, registrant, task and claimed commitment, and counts the circuits that aren't miners", async () => {
		const read = await readFabxMiners(replayClient(fixture), {
			ids: FABX_MINER_FIXTURE_IDS,
			blockNumber,
		});
		if (!read.complete) throw new Error(read.detail);
		expect(read.notMiners).toBe(1); // #25
		const byId = new Map(read.miners.map((m) => [m.id, m]));
		expect([...byId.keys()]).toEqual([24n, 1020n, 1648n, 1961n, 66n]);
		expect(byId.get(1648n)).toMatchObject({
			status: 1,
			taskId: 48,
			commitBlock: 73_128_498n,
		});
		expect(byId.get(1961n)).toMatchObject({
			status: 1,
			taskId: 48,
			commitBlock: 73_131_773n,
			firstUnusedId: 1960n,
		});
		expect(byId.get(24n)).toMatchObject({ status: 1, commitBlock: 0n });
		expect(byId.get(66n)).toMatchObject({ status: 3, stopBlock: 74_423_691n });
		expect(byId.get(24n)?.stopBlock).toBeNull();
		expect(byId.get(1961n)?.registrant).toBe(
			"0xf264c21243a974408d0564e50c54425904cd252e",
		);
	});

	test("a read the node can't answer is an error, never an empty list", async () => {
		const read = await readFabxMiners(replayClient(fixture), {
			ids: [24n],
			blockNumber,
		});
		expect(read.complete).toBe(false);
	});
});
