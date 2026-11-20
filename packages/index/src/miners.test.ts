import { replayClient } from "@foreman/chain-bnb/fixture";
import { scanMinerStarts } from "@foreman/originality";
import fixture from "@foreman/originality/fixtures/bnb-miner-starts-117268000-117271000.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { backfillCommitments, readMiners, saveMinerStarts } from "./index.ts";
import { emptyIndexAt, TEST_DATABASE_URL } from "./testing.ts";

// Started events in blocks 117,268,000 to 117,271,000 (112 starts by 111 miners; 0xb102…/647
// started twice) and getMiner at block 134,690,552 (packages/originality/fixtures/README.md).
const RANGE = { fromBlock: 117_268_000n, toBlock: 117_271_000n };
const INDEX_BLOCK = 134_690_552n;
const B102 = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";

async function startsScan() {
	const scan = await scanMinerStarts(replayClient(fixture), RANGE);
	if (!scan.complete) throw new Error(scan.detail);
	return scan;
}

describe.skipIf(!TEST_DATABASE_URL)("saving miners", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("keeps one row per miner, with its first and last start", async () => {
		pool = await emptyIndexAt(INDEX_BLOCK);
		await saveMinerStarts(pool, await startsScan());
		const miners = await readMiners(pool);
		expect(miners.upToBlock).toBe(117_271_000n);
		expect(miners.miners).toHaveLength(111);
		expect(
			miners.miners.find(
				(m) => m.circuit.processor === B102 && m.circuit.id === 647n,
			),
		).toEqual({
			key: "0x245dd4487fe9f6361bf2736b0be23ab62b90f1feeff2674ac07beb1d605d04dc",
			circuit: { processor: B102, id: 647n },
			firstStartedBlock: 117_268_905n,
			lastStartedBlock: 117_270_988n,
			starts: 2,
			commitment: { status: "not-read" },
		});
	});

	test("reads each miner's design commitment at the index's block", async () => {
		pool = await emptyIndexAt(INDEX_BLOCK);
		await saveMinerStarts(pool, await startsScan());
		const result = await backfillCommitments(pool, replayClient(fixture));
		expect(result).toEqual({
			atBlock: INDEX_BLOCK,
			read: 111,
			withCommitment: 7,
			failed: [],
			remaining: 0,
		});
		const { miners } = await readMiners(pool);
		expect(
			miners.find((m) => m.circuit.id === 1363n && m.circuit.processor === B102)
				?.commitment,
		).toEqual({
			status: "read",
			committedAt: 117_250_955n,
			readAtBlock: INDEX_BLOCK,
		});
		expect(
			miners.find((m) => m.circuit.id === 1150n && m.circuit.processor === B102)
				?.commitment,
		).toEqual({
			status: "read",
			committedAt: null,
			readAtBlock: INDEX_BLOCK,
		});
	});

	test("leaves a miner whose read failed unread, never as no commitment", async () => {
		pool = await emptyIndexAt(INDEX_BLOCK);
		await saveMinerStarts(pool, await startsScan());
		// The node doesn't answer 0xb102…/1363's getMiner, the one with a commitment
		const key =
			"c84c0701a910e5a764cd52dc238c3857c6044e50a86c038e0353b88e71d7d04a";
		const broken = {
			...fixture,
			calls: fixture.calls.filter(
				(c) => !(c.params as { data?: string }[])[0]?.data?.endsWith(key),
			),
		};
		const result = await backfillCommitments(pool, replayClient(broken));
		expect(result).toMatchObject({
			read: 110,
			withCommitment: 6,
			remaining: 1,
		});
		expect(result.failed).toEqual([
			{ key: `0x${key}`, detail: expect.any(String) },
		]);
		const { miners } = await readMiners(pool);
		expect(
			miners.find((m) => String(m.key) === `0x${key}`)?.commitment,
		).toEqual({
			status: "not-read",
		});
	});

	test("reads a miner's commitment again after it starts again, since a restart can change it", async () => {
		pool = await emptyIndexAt(INDEX_BLOCK);
		const scan = await startsScan();
		await saveMinerStarts(pool, scan);
		await backfillCommitments(pool, replayClient(fixture));

		// A made-up later start of 0xb102…/1363
		const earlier = scan.starts.find(
			(s) => s.circuit.processor === B102 && s.circuit.id === 1363n,
		);
		if (!earlier) throw new Error("0xb102…/1363 is not in the fixture");
		await saveMinerStarts(pool, {
			complete: true,
			upToBlock: 117_300_000n,
			starts: [
				{
					...earlier,
					startedAt: { block: 117_290_000n, txIndex: 0, logIndex: 0 },
				},
			],
		});
		const { upToBlock, miners } = await readMiners(pool);
		expect(upToBlock).toBe(117_300_000n);
		const m = miners.find((x) => x.key === earlier.key);
		expect(m).toMatchObject({
			starts: 2,
			lastStartedBlock: 117_290_000n,
			commitment: { status: "not-read" },
		});
		expect(miners.filter((x) => x.commitment.status === "read")).toHaveLength(
			110,
		);

		expect(
			await backfillCommitments(pool, replayClient(fixture)),
		).toMatchObject({ read: 1, remaining: 0 });
	});
});
