import { parseAddress, parseHex32 } from "@foreman/contract";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	type PublishedEntry,
	type ResultsContract,
	readPublished,
	recordPublished,
} from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// What the publish job has written to a results contract (docs/decisions/2026-11-21-publish-job.md,
// decision 2). Made-up rows: only the storage is under test.

const TESTNET: ResultsContract = {
	chainId: 1952,
	address: parseAddress(`0x${"aa".repeat(20)}`, "contract"),
};
const OTHER: ResultsContract = {
	chainId: 1952,
	address: parseAddress(`0x${"bb".repeat(20)}`, "contract"),
};
const hex32 = (byte: string) => parseHex32(`0x${byte.repeat(32)}`, "hex32");

function entry(keyByte: string, kind: number): PublishedEntry {
	return {
		key: hex32(keyByte),
		processor: parseAddress(
			"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
			"processor",
		),
		id: 17_663n,
		kind,
		canMine: 1,
		fingerprint: hex32("f1"),
		resultHash: hex32("e1"),
		indexBlock: 134_600_000n,
	};
}

describe.skipIf(!TEST_DATABASE_URL)("the published results record", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("reads back what was recorded, with its transaction, per contract", async () => {
		pool = await freshDatabase();
		const at = { tx: hex32("01"), block: 1_000n };
		await recordPublished(pool, TESTNET, [entry("0a", 2), entry("0b", 1)], at);

		const read = await readPublished(pool, TESTNET);
		expect(read.size).toBe(2);
		expect(read.get(hex32("0a"))).toEqual({ ...entry("0a", 2), ...at });
		expect((await readPublished(pool, OTHER)).size).toBe(0);
	});

	test("a republish replaces the circuit's row", async () => {
		pool = await freshDatabase();
		await recordPublished(pool, TESTNET, [entry("0a", 2)], {
			tx: hex32("01"),
			block: 1_000n,
		});
		await recordPublished(pool, TESTNET, [entry("0a", 1)], {
			tx: hex32("02"),
			block: 2_000n,
		});
		const read = await readPublished(pool, TESTNET);
		expect(read.size).toBe(1);
		expect(read.get(hex32("0a"))).toMatchObject({
			kind: 1,
			tx: hex32("02"),
			block: 2_000n,
		});
	});
});
