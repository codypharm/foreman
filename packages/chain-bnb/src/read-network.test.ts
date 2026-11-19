import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-134480825.json" with { type: "json" };
import { replayClient } from "./fixture.ts";
import { readNetworkState } from "./index.ts";

// Read with raw JSON-RPC at the same block, not by this reader
describe("reading the network from the BNB mining contract", () => {
	test("gives total weight and miner counts at the block it was read", async () => {
		const client = replayClient(fixture);
		expect(
			await readNetworkState(client, { blockNumber: 134_480_825n }),
		).toEqual({
			verifiedWeight: 1_613_102n,
			unverifiedWeight: 41_297n,
			minerCount: 20_818n,
			verifiedMinerCount: 20_170n,
			readAt: { chainId: 56, block: 134_480_825n, time: 1_795_081_182n },
		});
	});
});
