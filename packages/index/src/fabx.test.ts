import { decodeFabxLogs, type FabxMinerRecord, type XLayerLog } from "@foreman/chain-xlayer";
import fixture from "@foreman/chain-xlayer/fixtures/fabx-logs-sample.json" with { type: "json" };
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { readFabxState, saveFabxHistory, saveFabxMiners } from "./fabx.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// One real log of each kind from FabX's processor and mining contract, read on 25 Nov 2026
// (packages/chain-xlayer/fixtures/fabx-logs-sample.json). Storage: 2026-11-25-fabx-storage.md.
const logs: XLayerLog[] = fixture.logs.map((l) => ({
	address: l.address as XLayerLog["address"],
	topics: l.topics as XLayerLog["topics"],
	data: l.data as XLayerLog["data"],
	blockNumber: BigInt(l.blockNumber),
	transactionIndex: l.transactionIndex,
	logIndex: l.logIndex,
	transactionHash: l.transactionHash as XLayerLog["transactionHash"],
	blockTimestamp: BigInt(l.blockTimestamp),
}));
const decoded = decodeFabxLogs(logs);
if (!decoded.ok) throw new Error(decoded.detail);
const history = decoded;

/** The code reviewed on 25 Nov 2026, in place since block 73,517,253 (2026-11-25-fabx-history.md). */
const REVIEWED = {
	implementation: "0x90681776c2d6be4676d83fa8fef22836b5dbbeeb",
	atBlock: 73_517_253n,
} as const;
const FIRST = { fromBlock: 73_042_958n, toBlock: 76_847_895n };

const count = async (pool: pg.Pool, table: string) =>
	Number((await pool.query(`select count(*) from ${table}`)).rows[0].count);

describe.skipIf(!TEST_DATABASE_URL)("saving FabX's history", () => {
	let pool: pg.Pool;
	afterEach(async () => {
		await pool?.end();
	});

	test("stores each kind once, with how far it's read, and isn't frozen by changes before the review", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history }, REVIEWED);
		await saveFabxHistory(pool, { ...FIRST, history }, REVIEWED);
		expect(await count(pool, "xlayer_circuits")).toBe(1);
		expect(await count(pool, "fabx_design_commitments")).toBe(2);
		expect(await count(pool, "fabx_starts")).toBe(1);
		expect(await count(pool, "fabx_contract_events")).toBe(4);
		const row = (await pool.query("select id, taped_out_block, taped_out_time from xlayer_circuits")).rows[0];
		expect(row).toEqual({ id: "24", taped_out_block: "73044971", taped_out_time: "1791814007" });
		expect(await readFabxState(pool)).toEqual({
			logsUpToBlock: 76_847_895n,
			reviewed: REVIEWED,
			frozenAtBlock: null,
		});
	});

	test("a contract change after the reviewed block freezes FabX at its block", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history }, REVIEWED);
		const upgrade = history.contractEvents.find((e) => e.kind === "Upgraded")!;
		const fake = {
			...upgrade,
			at: { block: 76_900_000n, tx: 0, log: 0 },
			detail: { implementation: "0x000000000000000000000000000000000000dead" },
		};
		await saveFabxHistory(
			pool,
			{
				fromBlock: 76_847_896n,
				toBlock: 76_950_000n,
				history: { ...history, tapeOuts: [], commitments: [], starts: [], contractEvents: [fake] },
			},
			REVIEWED,
		);
		expect((await readFabxState(pool))?.frozenAtBlock).toBe(76_900_000n);
	});

	test("a range that doesn't start right after the stored one is refused, leaving no gap", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history }, REVIEWED);
		await expect(
			saveFabxHistory(pool, { fromBlock: 76_900_000n, toBlock: 76_950_000n, history }, REVIEWED),
		).rejects.toThrow("FabX's logs are stored up to block 76847895; this range starts at 76900000");
		expect((await readFabxState(pool))?.logsUpToBlock).toBe(76_847_895n);
	});
});

// Miners and their commitments (2026-11-25-fabx-commitment-designer.md), on a made-up history
// shaped on FabX #1961: committed at block 73,131,773 by the address that started it.
const P = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
const OWNER = "0xf264c21243a974408d0564e50c54425904cd252e" as const;
const at = (block: bigint, log = 0) => ({ block, tx: 0, log });
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const tapeOut = (id: bigint, block: bigint) => ({ processor: P, id, at: at(block), time: 1_791_800_000n + block - 73_000_000n, tapedOutBy: OWNER });
const minersHistory = {
	...history,
	tapeOuts: [tapeOut(24n, 73_044_971n), tapeOut(1020n, 73_115_400n), tapeOut(1961n, 73_131_781n)],
	commitments: [
		{ at: at(73_131_773n), txHash: hash(1), time: 1_791_900_809n, commitment: hash(2), designer: OWNER, circuits: P, claimedBlock: 73_131_773n, firstUnusedId: 1960n },
	],
	starts: [{ at: at(73_131_800n), key: hash(3), processor: P, id: 1961n, registrant: OWNER }],
	contractEvents: [],
};
const record = (id: bigint, commitBlock: bigint, firstUnusedId: bigint): FabxMinerRecord => ({
	processor: P, id, key: hash(Number(id)), status: 1, registrant: OWNER, taskId: 48, commitBlock, firstUnusedId,
});
const read = (block: bigint, miners: FabxMinerRecord[]) => ({ complete: true as const, block, miners, notMiners: 3 - miners.length });

const minerRows = async (pool: pg.Pool) =>
	(await pool.query("select id, commitment_status, commitment_time, confirmed_by_block from fabx_miners order by id")).rows;

describe.skipIf(!TEST_DATABASE_URL)("saving FabX's miners", () => {
	let pool: pg.Pool;
	afterEach(async () => {
		await pool?.end();
	});

	test("a commitment with its event is confirmed with the event's time; one without is unconfirmed; none is none", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history: minersHistory }, REVIEWED);
		await saveFabxMiners(pool, read(76_847_895n, [record(24n, 0n, 0n), record(1020n, 73_115_351n, 1020n), record(1961n, 73_131_773n, 1960n)]));
		expect(await minerRows(pool)).toEqual([
			{ id: "24", commitment_status: "none", commitment_time: null, confirmed_by_block: null },
			{ id: "1020", commitment_status: "unconfirmed", commitment_time: null, confirmed_by_block: null },
			{ id: "1961", commitment_status: "confirmed", commitment_time: "1791900809", confirmed_by_block: "73131773" },
		]);
		expect((await pool.query("select miners_read_at_block from xlayer_state")).rows[0].miners_read_at_block).toBe("76847895");
	});

	test("miners read at a block FabX's events aren't stored up to are refused", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history: minersHistory }, REVIEWED);
		await expect(saveFabxMiners(pool, read(76_900_000n, [record(24n, 0n, 0n)]))).rejects.toThrow(
			"FabX's events are stored up to block 76847895; miners read at 76900000 could miss a commitment's event",
		);
		expect(await count(pool, "fabx_miners")).toBe(0);
	});

	test("a read that doesn't cover every stored circuit is refused", async () => {
		pool = await freshDatabase();
		await saveFabxHistory(pool, { ...FIRST, history: minersHistory }, REVIEWED);
		await expect(
			saveFabxMiners(pool, { complete: true, block: 76_847_895n, miners: [record(24n, 0n, 0n)], notMiners: 0 }),
		).rejects.toThrow("the read covers 1 circuits; 3 are stored");
	});
});
