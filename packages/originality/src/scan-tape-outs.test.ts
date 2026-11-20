import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-tape-outs-116150000.json" with {
	type: "json",
};
import { scanTapeOuts } from "./index.ts";
import { withoutTapeOutLog, withTapeOutLog } from "./testing.ts";

// Every tape-out from the factory's first block with code (116,042,002) to block 116,150,000:
// 32 processors listed, 95 tape-outs on 6 of them (fixtures/README.md). Expected values were
// read from the saved JSON with an independent Python script, not from this code.
// Rules: docs/decisions/2026-11-20-circuit-index.md, decision 2.
const RANGE = { fromBlock: 116_042_002n, toBlock: 116_150_000n };
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

describe("scanning every tape-out", () => {
	test("gives every tape-out in chain order, with its position and address", async () => {
		const scan = await scanTapeOuts(replayClient(fixture), RANGE);
		expect(scan.complete).toBe(true);
		if (!scan.complete) return;
		expect(scan.upToBlock).toBe(116_150_000n);
		expect(scan.processors).toHaveLength(32);
		expect(scan.tapeOuts).toHaveLength(95);
		expect(scan.tapeOuts[0]).toEqual({
			circuit: { processor: P0, id: 1n },
			tapedOutAt: { block: 116_070_652n, txIndex: 27, logIndex: 114 },
			tapedOutBy: "0x571d447f4f24688ec35ccf07f1d6993655f6af15",
		});
		const order = scan.tapeOuts.map((t) => t.tapedOutAt);
		const sorted = [...order].sort((a, b) =>
			a.block !== b.block
				? Number(a.block - b.block)
				: a.txIndex !== b.txIndex
					? a.txIndex - b.txIndex
					: a.logIndex - b.logIndex,
		);
		expect(order).toEqual(sorted);
	});
});

describe("events the factory didn't list", () => {
	test("drops a TapedOut event from a contract the factory doesn't list, and reports it", async () => {
		const LOOK_ALIKE = "0x00000000000000000000000000000000000000aa";
		const f = withTapeOutLog(fixture, {
			address: LOOK_ALIKE,
			id: 1n,
			owner: "0x00000000000000000000000000000000000000bb",
			block: 116_100_000n,
			txIndex: 3,
			logIndex: 9,
		});
		const scan = await scanTapeOuts(replayClient(f), RANGE);
		expect(scan.complete).toBe(true);
		if (!scan.complete) return;
		expect(scan.tapeOuts).toHaveLength(95);
		expect(scan.tapeOuts.some((t) => t.circuit.processor === LOOK_ALIKE)).toBe(
			false,
		);
		expect(scan.dropped).toEqual([
			{
				address: LOOK_ALIKE,
				id: 1n,
				tapedOutAt: { block: 116_100_000n, txIndex: 3, logIndex: 9 },
			},
		]);
	});
});

describe("the count check", () => {
	test("stops the scan when a processor has fewer events than its nextId, and names it", async () => {
		// MINE6 issued 67 ids by block 116,150,000; the read is missing /40
		const f = withoutTapeOutLog(fixture, MINE6, 40n);
		const scan = await scanTapeOuts(replayClient(f), RANGE);
		expect(scan).toEqual({
			complete: false,
			reason: "count-mismatch",
			mismatches: [{ processor: MINE6, events: 66, nextId: 67 }],
			detail: expect.stringContaining(MINE6),
		});
	});
	test("stops the scan when the node returns no events at all, as a node without history does", async () => {
		const f = {
			...fixture,
			calls: fixture.calls.map((c) =>
				c.method === "eth_getLogs" ? { ...c, result: [] } : c,
			),
		};
		const scan = await scanTapeOuts(replayClient(f), RANGE);
		expect(scan).toMatchObject({ complete: false, reason: "count-mismatch" });
		if (scan.complete || scan.reason !== "count-mismatch") return;
		expect(scan.mismatches).toHaveLength(6);
	});
});

describe("a read that fails", () => {
	test("is a clear error naming the blocks, never a partial scan", async () => {
		// The second log read (blocks 116,092,002 to 116,142,001) gets no answer
		const f = {
			...fixture,
			calls: fixture.calls.filter(
				(c) =>
					!(
						c.method === "eth_getLogs" &&
						(c.params as { fromBlock: string }[])[0]?.fromBlock === "0x6eb6c62"
					),
			),
		};
		const scan = await scanTapeOuts(replayClient(f), RANGE);
		expect(scan).toEqual({
			complete: false,
			reason: "read-failed",
			detail: expect.stringContaining("blocks 116092002 to 116142001"),
		});
	});
});
