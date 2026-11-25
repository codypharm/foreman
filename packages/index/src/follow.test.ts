import { type Fixture, replayClient } from "@foreman/chain-bnb/fixture";
import { FACTORY_FIRST_BLOCK, scanTapeOuts } from "@foreman/originality";
import starts from "@foreman/originality/fixtures/bnb-miner-starts-117268000-117271000.json" with {
	type: "json",
};
import tapeOuts from "@foreman/originality/fixtures/bnb-tape-outs-116150000.json" with {
	type: "json",
};
import {
	logsByAddressClient,
	withoutTapeOutLog,
} from "@foreman/originality/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	followIndex,
	loadCircuitIndex,
	readIndex,
	readMiners,
	saveMinerRevokes,
	saveMinerStarts,
	saveScan,
} from "./index.ts";
import { emptyIndexAt, freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// Following the index (docs/decisions/2026-11-20-circuit-index.md, decision 5): the tape-out
// fixture's blocks in two parts. The index holds the first part, to block 116,092,001 (2
// tape-outs); the follow reads the rest, to 116,150,000 (93 more). Mining started at block
// 117,234,441, so no miner start or revoke can be in these blocks.
const SPLIT = 116_092_001n;
const HEAD = 116_150_000n;
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

/** The fixture as a node that answers log reads by address, as the follow now asks publicnode. */
const follower = (f: Fixture) => logsByAddressClient(f).client;

/** An index built to SPLIT: tape-outs saved, miner starts and revokes read to the same block. */
async function indexToSplit(): Promise<pg.Pool> {
	const pool = await freshDatabase();
	const first = await scanTapeOuts(replayClient(tapeOuts), {
		fromBlock: FACTORY_FIRST_BLOCK,
		toBlock: SPLIT,
	});
	if (!first.complete) throw new Error(first.detail);
	await saveScan(pool, first);
	await saveMinerStarts(pool, { complete: true, upToBlock: SPLIT, starts: [] });
	await saveMinerRevokes(pool, {
		complete: true,
		upToBlock: SPLIT,
		revokes: [],
	});
	return pool;
}

describe.skipIf(!TEST_DATABASE_URL)("following the index", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("brings tape-outs, miner starts and revokes up to the same block", async () => {
		pool = await indexToSplit();
		const result = await followIndex(pool, follower(tapeOuts), {
			toBlock: HEAD,
		});
		expect(result).toMatchObject({
			followed: true,
			toBlock: HEAD,
			tapeOuts: 93,
			starts: 0,
			revokes: 0,
		});
		const whole = await scanTapeOuts(replayClient(tapeOuts), {
			fromBlock: FACTORY_FIRST_BLOCK,
			toBlock: HEAD,
		});
		if (!whole.complete) throw new Error(whole.detail);
		const index = await readIndex(pool);
		expect(index.upToBlock).toBe(HEAD);
		expect(index.tapeOuts).toEqual(whole.tapeOuts);
		expect(index.processors).toContainEqual({ address: MINE6, issued: 67n });
		const miners = await readMiners(pool);
		expect(miners.upToBlock).toBe(HEAD);
		expect(miners.revokesUpToBlock).toBe(HEAD);
	});

	test("reads every new netlist at the block it follows to", async () => {
		pool = await indexToSplit();
		const result = await followIndex(pool, follower(tapeOuts), {
			toBlock: HEAD,
		});
		expect(result).toMatchObject({
			followed: true,
			netlists: {
				atBlock: HEAD,
				read: 95,
				unreadable: 0,
				failed: [],
				remaining: 0,
			},
		});
		expect(await loadCircuitIndex(pool)).toMatchObject({
			ready: true,
			index: { upTo: [{ chainId: 56, block: HEAD }] },
			notCompared: { unread: 0, unreadable: 0 },
		});
	});

	test("leaves a netlist whose read failed unread, to be read on the next follow", async () => {
		pool = await indexToSplit();
		// The node doesn't answer MINE6/40's netlist read
		const id40 = (40).toString(16).padStart(64, "0");
		const broken = {
			...tapeOuts,
			calls: tapeOuts.calls.filter((c) => {
				const p = (c.params as { to?: string; data?: string }[])[0];
				return !(
					c.method === "eth_call" &&
					p?.to?.toLowerCase() === MINE6 &&
					p.data === `0x3fc4be56${id40}`
				);
			}),
		};
		const result = await followIndex(pool, follower(broken), {
			toBlock: HEAD,
		});
		expect(result).toMatchObject({
			followed: true,
			netlists: {
				read: 94,
				failed: [{ circuit: { processor: MINE6, id: 40n } }],
				remaining: 1,
			},
		});
		expect(await loadCircuitIndex(pool)).toMatchObject({
			ready: true,
			notCompared: { unread: 1, unreadable: 0 },
		});
	});

	test("saves nothing when the tape-out count check fails, and names the processor", async () => {
		pool = await indexToSplit();
		// MINE6/40 is taped out after the split; the node leaves it out
		const gap = withoutTapeOutLog(tapeOuts, MINE6, 40n);
		const result = await followIndex(pool, follower(gap), {
			toBlock: HEAD,
		});
		expect(result).toEqual({
			followed: false,
			stage: "tape-outs",
			detail: expect.stringContaining(MINE6),
		});
		expect((await readIndex(pool)).upToBlock).toBe(SPLIT);
		expect((await readMiners(pool)).upToBlock).toBe(SPLIT);
	});

	test("reads miner starts from the block after the last one read, and their commitments", async () => {
		// Miner starts read to 117,267,999; the follow reads 117,268,000 to 117,271,000 (112 starts by
		// 111 miners) and their commitments at the index's block, 134,690,552
		pool = await emptyIndexAt(134_690_552n);
		await saveMinerStarts(pool, {
			complete: true,
			upToBlock: 117_267_999n,
			starts: [],
		});
		await saveMinerRevokes(pool, {
			complete: true,
			upToBlock: 117_271_000n,
			revokes: [],
		});
		const result = await followIndex(pool, replayClient(starts), {
			toBlock: 117_271_000n,
		});
		expect(result).toMatchObject({
			followed: true,
			tapeOuts: 0,
			starts: 112,
			revokes: 0,
			commitments: { read: 111, withCommitment: 7, remaining: 0 },
		});
		const miners = await readMiners(pool);
		expect(miners.upToBlock).toBe(117_271_000n);
		expect(miners.miners).toHaveLength(111);
		expect(miners.miners.filter((m) => m.starts === 2)).toHaveLength(1);
	});

	test("does nothing when the index is already at the block", async () => {
		pool = await indexToSplit();
		expect(
			await followIndex(pool, replayClient({ ...tapeOuts, calls: [] }), {
				toBlock: SPLIT,
			}),
		).toMatchObject({ followed: true, tapeOuts: 0, starts: 0, revokes: 0 });
		expect((await readIndex(pool)).upToBlock).toBe(SPLIT);
	});

	test("leaves the market alone until its first fill, and says so", async () => {
		pool = await indexToSplit();
		const result = await followIndex(pool, follower(tapeOuts), {
			toBlock: HEAD,
		});
		expect(result).toMatchObject({
			followed: true,
			market: {
				followed: false,
				detail: "not filled yet: run the market's first fill",
			},
		});
	});

	test("follows the market from its own last block", async () => {
		pool = await indexToSplit();
		// A market already read to HEAD: nothing to read, so no call is made
		await pool.query(
			"update index_state set market_up_to_block = $1, market_up_to_time = 1",
			[HEAD.toString()],
		);
		const result = await followIndex(pool, follower(tapeOuts), {
			toBlock: HEAD,
		});
		expect(result).toMatchObject({
			followed: true,
			market: { followed: true, toBlock: HEAD, sales: 0, listings: 0 },
		});
	});
});
