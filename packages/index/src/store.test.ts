import { replayClient } from "@foreman/chain-bnb/fixture";
import { scanTapeOuts } from "@foreman/originality";
import fixture from "@foreman/originality/fixtures/bnb-tape-outs-116150000.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { type CompleteScan, readIndex, saveScan } from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// The tape-out scan of blocks 116,042,002 to 116,150,000: 32 processors, 95 tape-outs
// (packages/originality/fixtures/README.md). Storage: docs/decisions/2026-11-20-database-access.md.
const RANGE = { fromBlock: 116_042_002n, toBlock: 116_150_000n };

const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

/** A made-up scan of the next blocks: MINE6/68, taped out at block 116,160,000. */
function laterScan(scan: CompleteScan): CompleteScan {
	return {
		...scan,
		upToBlock: 116_200_000n,
		processors: scan.processors.map((p) =>
			p.address === MINE6 ? { ...p, issued: 68n } : p,
		),
		tapeOuts: [
			{
				circuit: { processor: MINE6, id: 68n },
				tapedOutAt: { block: 116_160_000n, txIndex: 0, logIndex: 0 },
				tapedOutBy: "0x571d447f4f24688ec35ccf07f1d6993655f6af15",
			},
		],
	};
}

async function fixtureScan() {
	const scan = await scanTapeOuts(replayClient(fixture), RANGE);
	if (!scan.complete) throw new Error(`fixture scan stopped: ${scan.detail}`);
	return scan;
}

if (!TEST_DATABASE_URL) {
	console.warn(
		"Storage tests skipped: TEST_DATABASE_URL is not set (see .env.example)",
	);
}

describe.skipIf(!TEST_DATABASE_URL)("saving the index", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("reads back every tape-out, every processor and the block it is complete up to", async () => {
		pool = await freshDatabase();
		const scan = await fixtureScan();
		await saveScan(pool, scan);
		const index = await readIndex(pool);
		expect(index.upToBlock).toBe(116_150_000n);
		expect(index.tapeOuts).toEqual(scan.tapeOuts);
		expect(index.processors).toHaveLength(32);
		expect(index.processors).toContainEqual({ address: MINE6, issued: 67n });
	});

	test("a later scan adds its tape-outs and moves the index forward", async () => {
		pool = await freshDatabase();
		const scan = await fixtureScan();
		await saveScan(pool, scan);
		await saveScan(pool, laterScan(scan));
		const index = await readIndex(pool);
		expect(index.upToBlock).toBe(116_200_000n);
		expect(index.tapeOuts).toHaveLength(96);
		expect(index.tapeOuts.at(-1)?.circuit).toEqual({
			processor: MINE6,
			id: 68n,
		});
		expect(index.processors).toContainEqual({ address: MINE6, issued: 68n });
	});

	test("a save that fails part-way leaves the index exactly as it was", async () => {
		pool = await freshDatabase();
		const scan = await fixtureScan();
		await saveScan(pool, scan);
		const before = await readIndex(pool);

		// The later scan, then one tape-out already stored (an overlapping read)
		const later = laterScan(scan);
		const first = scan.tapeOuts[0];
		if (!first) throw new Error("fixture scan is empty");
		const overlapping = { ...later, tapeOuts: [...later.tapeOuts, first] };
		await expect(saveScan(pool, overlapping)).rejects.toThrow();
		expect(await readIndex(pool)).toEqual(before);
	});
});
