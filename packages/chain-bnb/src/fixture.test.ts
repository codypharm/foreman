import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-134480825.json" with { type: "json" };
import { MULTICALL3 } from "./abi.ts";
import { replayClient } from "./fixture.ts";
import { readMiner } from "./index.ts";

// The replay client with call bundling (docs/decisions/2026-11-22-results-reads-multicall.md): the
// client packs reads made together at one block into Multicall3 calls, and the replay answers each
// bundle from the recorded single reads inside it, as the contract would. Two real miners at BNB
// block 134,480,825 (read-miner.test.ts).

const BLOCK = 134_480_825n;
const KEYS = [
	"0x5f71526db52dc674414b1290a7ce436ab64fd61133b406ca067cbf8d7e4e6cf9",
	"0x146fed016999565b17ebee4442c9440fc97dfd312193463c9d54f33113b79fdb",
].map((k) => parseHex32(k, "key"));

describe("a replay with bundled reads", () => {
	test("answers reads made together in Multicall3 bundles, the same as one by one", async () => {
		const asked: string[] = [];
		const bundled = replayClient(fixture, { multicall: true, asked });
		const together = await Promise.all(
			KEYS.map((k) => readMiner(bundled, k, { blockNumber: BLOCK })),
		);
		const plain = replayClient(fixture);
		const oneByOne = [];
		for (const k of KEYS) {
			oneByOne.push(await readMiner(plain, k, { blockNumber: BLOCK }));
		}
		expect(together).toEqual(oneByOne);
		expect(asked).toContain(`eth_call:${MULTICALL3}`);
	});

	test("fails a bundled read that was never recorded, never answering it", async () => {
		const bundled = replayClient(fixture, { multicall: true });
		await expect(
			readMiner(bundled, KEYS[0] as (typeof KEYS)[0], {
				blockNumber: BLOCK - 1n,
			}),
		).rejects.toThrow();
	});
});
