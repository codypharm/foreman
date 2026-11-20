import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import circuits from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import fixture from "../fixtures/bnb-miner-starts-117268000-117271000.json" with {
	type: "json",
};
import { minerKey, readDesignCommitment, scanMinerStarts } from "./index.ts";

// Every Started event on the mining contract in blocks 117,268,000 to 117,271,000: 112 starts
// by 111 miners, one of them a restart (fixtures/README.md). Expected values were read from the
// saved JSON with a separate Python script, not from this code.
const RANGE = { fromBlock: 117_268_000n, toBlock: 117_271_000n };
const B102 = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const INDEX_BLOCK = { blockNumber: 134_690_552n };

describe("scanning miner starts", () => {
	test("gives every start with the miner's key, its circuit and its position", async () => {
		const scan = await scanMinerStarts(replayClient(fixture), RANGE);
		expect(scan.complete).toBe(true);
		if (!scan.complete) return;
		expect(scan.upToBlock).toBe(117_271_000n);
		expect(scan.starts).toHaveLength(112);
		expect(scan.starts[0]).toEqual({
			key: "0xb81601a3b59f1accd47ca5cc817e7ea1228725fc455d7d1541989bb0c47ce8cc",
			circuit: { processor: B102, id: 1150n },
			startedAt: { block: 117_268_030n, txIndex: 42, logIndex: 170 },
		});
	});

	test("gives a miner that stopped and started again as two starts", async () => {
		const scan = await scanMinerStarts(replayClient(fixture), RANGE);
		if (!scan.complete) throw new Error(scan.detail);
		const starts = scan.starts.filter(
			(s) => s.circuit.processor === B102 && s.circuit.id === 647n,
		);
		expect(starts.map((s) => s.startedAt)).toEqual([
			{ block: 117_268_905n, txIndex: 49, logIndex: 153 },
			{ block: 117_270_988n, txIndex: 61, logIndex: 390 },
		]);
		expect(new Set(starts.map((s) => s.key)).size).toBe(1);
	});
});

describe("a start read that fails", () => {
	test("is a clear error naming the blocks, never a partial list", async () => {
		const f = {
			...fixture,
			calls: fixture.calls.filter((c) => c.method !== "eth_getLogs"),
		};
		expect(await scanMinerStarts(replayClient(f), RANGE)).toEqual({
			complete: false,
			reason: "read-failed",
			detail: expect.stringContaining("blocks 117268000 to 117271000"),
		});
	});
});

describe("reading a miner's design commitment", () => {
	test("gives the block of the commitment the mining contract accepted", async () => {
		const key = minerKey({ processor: B102, id: 1363n });
		expect(
			await readDesignCommitment(replayClient(fixture), key, INDEX_BLOCK),
		).toEqual({
			read: true,
			committedAt: 117_250_955n,
		});
	});

	test("gives none for a miner that started without a commitment", async () => {
		const key = minerKey({ processor: B102, id: 1150n });
		expect(key).toBe(
			"0xb81601a3b59f1accd47ca5cc817e7ea1228725fc455d7d1541989bb0c47ce8cc",
		);
		expect(
			await readDesignCommitment(replayClient(fixture), key, INDEX_BLOCK),
		).toEqual({
			read: true,
			committedAt: null,
		});
	});

	test("gives the commitment that makes MINE6/2683 the earlier design, though taped out later", async () => {
		// fixtures/README.md: commitment 122,268,369, taped out 127,718,339
		const key = minerKey({ processor: MINE6, id: 2683n });
		expect(
			await readDesignCommitment(replayClient(circuits), key, {
				blockNumber: 134_673_279n,
			}),
		).toEqual({ read: true, committedAt: 122_268_369n });
	});

	test("a failed read is a clear error, never no commitment", async () => {
		const key = minerKey({ processor: B102, id: 1363n });
		const f = { ...fixture, calls: [] };
		expect(
			await readDesignCommitment(replayClient(f), key, INDEX_BLOCK),
		).toEqual({
			read: false,
			detail: expect.stringContaining(key),
		});
	});
});
