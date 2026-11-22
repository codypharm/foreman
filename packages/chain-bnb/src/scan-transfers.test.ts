import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-transfers-135080000-135129999.json" with {
	type: "json",
};
import { replayClient } from "./fixture.ts";
import { scanCircuitTransfers } from "./index.ts";

// The circuit NFTs' Transfer events on the two eligible processors, blocks 135,080,000 to
// 135,129,999 (docs/decisions/2026-11-22-wallet-miners.md): 14 transfers, 7 of them mints, read from
// the archive node on 22 Nov 2026. The fixture also holds each circuit's ownerOf at the window's
// last block, read independently of the events.

const RANGE = { fromBlock: 135_080_000n, toBlock: 135_129_999n };
const ZERO = "0x0000000000000000000000000000000000000000";
const ownerOfAbi = [
	{
		name: "ownerOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
	},
] as const;

describe("scanning circuit transfers", () => {
	test("gives every transfer of the eligible processors in chain order, mints included", async () => {
		const scan = await scanCircuitTransfers(replayClient(fixture), RANGE);
		if (!scan.complete) throw new Error(scan.detail);
		expect(scan.upToBlock).toBe(RANGE.toBlock);
		expect(scan.transfers).toHaveLength(14);
		expect(
			scan.transfers.filter((t) => (t.from as string) === ZERO),
		).toHaveLength(7);
		const order = scan.transfers.map((t) => [
			t.at.block,
			t.at.txIndex,
			t.at.logIndex,
		]);
		const sorted = [...order].sort(
			(a, b) =>
				Number((a[0] as bigint) - (b[0] as bigint)) ||
				Number(a[1]) - Number(b[1]) ||
				Number(a[2]) - Number(b[2]),
		);
		expect(order).toEqual(sorted);
	});

	test("each circuit's last transfer names its owner at the last block, as the processor's ownerOf does", async () => {
		const client = replayClient(fixture);
		const scan = await scanCircuitTransfers(client, RANGE);
		if (!scan.complete) throw new Error(scan.detail);
		const last = new Map<
			string,
			{ processor: string; id: bigint; to: string }
		>();
		for (const t of scan.transfers) {
			last.set(`${t.processor}/${t.id}`, t);
		}
		expect(last.size).toBeGreaterThan(0);
		for (const t of last.values()) {
			const owner = await client.readContract({
				address: t.processor as `0x${string}`,
				abi: ownerOfAbi,
				functionName: "ownerOf",
				args: [t.id],
				blockNumber: RANGE.toBlock,
			});
			expect(owner.toLowerCase(), `${t.processor}/${t.id}`).toBe(t.to);
		}
	});

	test("a failed read stops the scan, never a partial list", async () => {
		const scan = await scanCircuitTransfers(
			replayClient({ ...fixture, calls: [] }),
			RANGE,
		);
		expect(scan).toMatchObject({ complete: false, reason: "read-failed" });
	});
});
