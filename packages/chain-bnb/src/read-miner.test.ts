import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-134480825.json" with { type: "json" };
import { replayClient } from "./fixture.ts";
import { readMiner, UnknownMinerError } from "./index.ts";

// Real miners at BNB block 134,480,825 (19 Nov 2026). The expected values were read with
// raw JSON-RPC and decoded by a separate decoder, not by this reader.
const BLOCK = 134_480_825n;
const BLOCK_TIME = 1_795_081_182n;
const OWNER = "0x6688928b01768c92e5f6fafbcf381bee23727395";
const client = replayClient(fixture);
const key = (hex: string) => parseHex32(hex, "key");

describe("reading a miner from the BNB mining contract", () => {
	test("gives a verified miner without the bonus, at the block it was read", async () => {
		const k = key(
			"0x5f71526db52dc674414b1290a7ce436ab64fd61133b406ca067cbf8d7e4e6cf9",
		);
		expect(await readMiner(client, k, { blockNumber: BLOCK })).toEqual({
			key: k,
			processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
			tokenId: 996n,
			owner: OWNER,
			status: "active",
			pool: "verified",
			taskId: 34,
			weight: 124n,
			weightWithoutBonus: 124n,
			holdsBonus: false,
			miningSince: 1_787_345_411n,
			readAt: { chainId: 56, block: BLOCK, time: BLOCK_TIME },
		});
	});

	test("gives a bonus holder's weight with and without the bonus", async () => {
		// (bstar 59 + bonus 336) × mult 6 = 2,370; without the bonus 59 × 6 = 354
		const k = key(
			"0x146fed016999565b17ebee4442c9440fc97dfd312193463c9d54f33113b79fdb",
		);
		const miner = await readMiner(client, k, { blockNumber: BLOCK });
		expect(miner).toMatchObject({
			processor: "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
			tokenId: 524n,
			taskId: 69,
			weight: 2_370n,
			weightWithoutBonus: 354n,
			holdsBonus: true,
		});
	});

	test("refuses a key the mining contract has never seen", async () => {
		const k = key(
			"0x0000000000000000000000000000000000000000000000000000000000000001",
		);
		await expect(readMiner(client, k, { blockNumber: BLOCK })).rejects.toThrow(
			UnknownMinerError,
		);
	});
});
