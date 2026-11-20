import { replayClient } from "@foreman/chain-bnb/fixture";
import type { Address } from "viem";
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
			tapedOutAt: {
				block: 116_070_652n,
				txIndex: 27,
				logIndex: 114,
				time: 1_786_792_493n,
			},
			tapedOutBy: "0x571d447f4f24688ec35ccf07f1d6993655f6af15",
		});
		// Every tape-out carries its block's time, never a blank
		expect(scan.tapeOuts.every((t) => t.tapedOutAt.time > 0n)).toBe(true);
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

describe("block times", () => {
	test("stops the scan when the node leaves out a tape-out's block time, naming the circuit", async () => {
		const f = {
			...fixture,
			calls: fixture.calls.map((c) =>
				c.method === "eth_getLogs"
					? {
							...c,
							result: (c.result as { blockNumber: string }[]).map((l) =>
								BigInt(l.blockNumber) === 116_070_652n
									? { ...l, blockTimestamp: undefined }
									: l,
							),
						}
					: c,
			),
		};
		const scan = await scanTapeOuts(replayClient(f), RANGE);
		expect(scan).toEqual({
			complete: false,
			reason: "read-failed",
			detail: expect.stringContaining(`${P0}/1 in block 116070652`),
		});
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

describe("following from an earlier scan", () => {
	// The same blocks in two parts: a scan to block 116,092,001 (2 processors, 2 tape-outs), then
	// the rest. The second part's count check adds the tape-outs already indexed.
	const SPLIT = 116_092_001n;

	async function firstPart() {
		const scan = await scanTapeOuts(replayClient(fixture), {
			fromBlock: RANGE.fromBlock,
			toBlock: SPLIT,
		});
		if (!scan.complete) throw new Error(scan.detail);
		const indexed = new Map<Address, number>();
		for (const t of scan.tapeOuts) {
			const p = t.circuit.processor;
			indexed.set(p, (indexed.get(p) ?? 0) + 1);
		}
		return { scan, indexed };
	}

	test("checks each processor's nextId against the tape-outs already indexed plus those read", async () => {
		const { scan: first, indexed } = await firstPart();
		expect(first.tapeOuts).toHaveLength(2);
		const rest = await scanTapeOuts(
			replayClient(fixture),
			{ fromBlock: SPLIT + 1n, toBlock: RANGE.toBlock },
			undefined,
			indexed,
		);
		expect(rest.complete).toBe(true);
		if (!rest.complete) return;
		expect(rest.processors).toHaveLength(32);
		const whole = await scanTapeOuts(replayClient(fixture), RANGE);
		if (!whole.complete) throw new Error(whole.detail);
		expect([...first.tapeOuts, ...rest.tapeOuts]).toEqual(whole.tapeOuts);
	});

	test("stops when the tape-outs already indexed don't add up, naming the processor", async () => {
		const { indexed } = await firstPart();
		const [processor, n] = [...indexed][0] as [Address, number];
		const wrong = new Map(indexed).set(processor, n - 1);
		const rest = await scanTapeOuts(
			replayClient(fixture),
			{ fromBlock: SPLIT + 1n, toBlock: RANGE.toBlock },
			undefined,
			wrong,
		);
		expect(rest).toMatchObject({
			complete: false,
			reason: "count-mismatch",
			detail: expect.stringContaining(processor),
		});
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
