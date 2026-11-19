import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-history.json" with { type: "json" };
import { replayClient } from "./fixture.ts";
import { blockAtOrAfter, readNetworkHistory } from "./index.ts";

// Recorded from a live node; see scripts/record-history-fixture.ts for the times used
const client = replayClient(fixture);
const { times } = fixture as unknown as { times: string[] };

describe("network history", () => {
	const { window } = fixture as unknown as {
		window: { from: string; to: string; every: string };
	};
	const from = BigInt(window.from);
	const to = BigInt(window.to);
	const every = BigInt(window.every);

	test("gives network state at each step, read at the first block at or after it", async () => {
		const history = await readNetworkHistory(client, { from, to, every });
		expect(history).toHaveLength(times.length);
		for (const [i, sample] of history.entries()) {
			const time = BigInt(times[i] as string);
			expect(sample.readAt.block).toBe(await blockAtOrAfter(client, time));
			expect(sample.verifiedWeight > 0n).toBe(true);
		}
		const blocks = history.map((s) => s.readAt.block);
		expect(blocks).toEqual([...blocks].sort((a, b) => (a < b ? -1 : 1)));
	});

	test.each([
		["a step of zero", { every: 0n }],
		["a negative step", { every: -900n }],
		["an end before the start", { to: 0n }],
	])("refuses %s", async (_why, bad) => {
		await expect(
			readNetworkHistory(client, { from, to, every, ...bad }),
		).rejects.toThrow(RangeError);
	});
});

describe("finding the block for a time", () => {
	test.each(times)("gives the first block at or after %s", async (wire) => {
		const time = BigInt(wire);
		const found = await blockAtOrAfter(client, time);
		const block = await client.getBlock({ blockNumber: found });
		const before = await client.getBlock({ blockNumber: found - 1n });
		expect(block.timestamp >= time).toBe(true);
		expect(before.timestamp < time).toBe(true);
	});
});
