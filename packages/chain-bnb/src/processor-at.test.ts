import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-processor-at.json" with { type: "json" };
import { replayClient } from "./fixture.ts";
import { readProcessorAt } from "./index.ts";

// TapeOut's market labels a circuit "13931.30": its id, then its processor's place in the factory
// (docs/decisions/2026-11-27-tapeout-circuit-label.md). Replayed from BNB block 136,041,885.

const blockNumber = BigInt(fixture.block);

describe("a processor by its place in TapeOut's factory", () => {
	test("place 30 is the TapeOut processor", async () => {
		expect(
			await readProcessorAt(replayClient(fixture), {
				position: 30n,
				blockNumber,
			}),
		).toEqual({
			found: true,
			processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
			blockNumber,
		});
	});

	test("a place past the factory's count is no processor, with the count it was read against", async () => {
		expect(
			await readProcessorAt(replayClient(fixture), {
				position: 1_000_000n,
				blockNumber,
			}),
		).toEqual({ found: false, count: 1499n, blockNumber });
	});

	test("a failed read throws, never 'no processor'", async () => {
		await expect(
			readProcessorAt(replayClient({ ...fixture, calls: [] }), {
				position: 30n,
				blockNumber,
			}),
		).rejects.toThrow();
	});
});
