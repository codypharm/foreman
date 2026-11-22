import { MULTICALL3, multicall3Abi } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import {
	type Address,
	createPublicClient,
	custom,
	decodeFunctionData,
	decodeFunctionResult,
	encodeFunctionResult,
	type Hex,
	toFunctionSelector,
} from "viem";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-tape-outs-116150000.json" with {
	type: "json",
};
import { FACTORY, scanTapeOuts } from "./index.ts";
import {
	logsByAddressClient,
	withoutTapeOutLog,
	withTapeOutLog,
} from "./testing.ts";

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

/** The fixture's replay, with one read inside a Multicall3 bundle failing, as a revert would. */
function failingInBundle(target: string, selector: Hex) {
	const replay = replayClient(fixture);
	return createPublicClient({
		transport: custom({
			async request(args) {
				const answer = await replay.request(args as never);
				const p = (args.params as [{ to?: string; data?: Hex }])?.[0];
				if (args.method !== "eth_call" || p?.to?.toLowerCase() !== MULTICALL3)
					return answer;
				const calls = decodeFunctionData({
					abi: multicall3Abi,
					data: p.data as Hex,
				}).args[0];
				const results = decodeFunctionResult({
					abi: multicall3Abi,
					functionName: "aggregate3",
					data: answer as Hex,
				});
				return encodeFunctionResult({
					abi: multicall3Abi,
					functionName: "aggregate3",
					result: results.map((r, i) =>
						calls[i]?.target.toLowerCase() === target &&
						calls[i]?.callData.startsWith(selector)
							? { success: false, returnData: "0x" as Hex }
							: r,
					),
				});
			},
		}),
	});
}

describe("listing the processors", () => {
	// docs/decisions/2026-11-22-follow-processor-reads-multicall.md: 22 Nov 2026, the follow spent
	// about 130 of its 170 s reading 1,496 processors 25 at a time
	test("reads them in Multicall3 bundles, never one call each", async () => {
		const asked: string[] = [];
		const scan = await scanTapeOuts(replayClient(fixture, { asked }), RANGE);
		expect(scan.complete).toBe(true);
		if (!scan.complete) return;
		expect(scan.processors).toHaveLength(32);
		expect(asked).toContain(`eth_call:${MULTICALL3}`);
		// Only cpuCount goes to the factory itself, and nothing to a processor
		expect(asked.filter((a) => a === `eth_call:${FACTORY}`)).toHaveLength(1);
		const processors = new Set(
			scan.processors.map((p) => `eth_call:${p.address}`),
		);
		expect(asked.filter((a) => processors.has(a))).toEqual([]);
	});

	test("a processor read that fails inside its bundle stops the scan, never drops the processor", async () => {
		const scan = await scanTapeOuts(
			failingInBundle(MINE6, toFunctionSelector("nextId()")),
			RANGE,
		);
		expect(scan).toEqual({
			complete: false,
			reason: "read-failed",
			detail: expect.stringContaining(MINE6),
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
			logsByAddressClient(fixture).client,
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

	test("reads TapedOut only from the processors whose nextId grew, at most 10 addresses a read, and finds the same tape-outs", async () => {
		const { scan: first, indexed } = await firstPart();
		const { client, asked } = logsByAddressClient(fixture);
		const rest = await scanTapeOuts(
			client,
			{ fromBlock: SPLIT + 1n, toBlock: RANGE.toBlock },
			undefined,
			indexed,
		);
		if (!rest.complete) throw new Error(rest.detail);
		const whole = await scanTapeOuts(replayClient(fixture), RANGE);
		if (!whole.complete) throw new Error(whole.detail);
		expect([...first.tapeOuts, ...rest.tapeOuts]).toEqual(whole.tapeOuts);
		// Only the processors that issued ids after the split: 6 tape out by 116,150,000
		const grown = whole.processors
			.filter((p) => p.issued > BigInt(indexed.get(p.address) ?? 0))
			.map((p) => p.address);
		expect(asked.every((a) => a !== undefined && a.length <= 10)).toBe(true);
		expect(new Set(asked.flat())).toEqual(new Set(grown));
	});

	test("stops when the tape-outs already indexed don't add up, naming the processor", async () => {
		const { indexed } = await firstPart();
		const [processor, n] = [...indexed][0] as [Address, number];
		const wrong = new Map(indexed).set(processor, n - 1);
		const rest = await scanTapeOuts(
			logsByAddressClient(fixture).client,
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
