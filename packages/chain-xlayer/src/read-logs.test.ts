import { describe, expect, test } from "vitest";
import { type LogNode, readLogs } from "./read-logs.ts";

const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;

/** A node holding logs at the given blocks; it answers eth_getLogs like X Layer's public nodes. */
function node(
	atBlocks: number[],
	opts: { failFirst?: number; empty?: boolean } = {},
): LogNode & { calls: [bigint, bigint][] } {
	let failures = opts.failFirst ?? 0;
	const calls: [bigint, bigint][] = [];
	return {
		calls,
		async request({ method, params }) {
			if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
			const [q] = params as [{ fromBlock: string; toBlock: string }];
			const from = BigInt(q.fromBlock);
			const to = BigInt(q.toBlock);
			calls.push([from, to]);
			if (to - from + 1n > 100n)
				throw Object.assign(new Error("range too large"), {
					shortMessage: "block range is too large",
				});
			if (failures > 0) {
				failures--;
				throw Object.assign(new Error("rate"), {
					shortMessage: "over rate limit",
				});
			}
			if (opts.empty) return [];
			// Two logs per block, in reverse so the reader must order them
			return atBlocks
				.filter((b) => BigInt(b) >= from && BigInt(b) <= to)
				.flatMap((b) => [1, 0].map((i) => ({
					address: FABX,
					topics: ["0x01"],
					data: "0x",
					blockNumber: hex(b),
					transactionIndex: hex(i),
					logIndex: hex(i),
					transactionHash: `0x${"ab".repeat(32)}`,
					blockTimestamp: hex(1_791_800_000 + b),
				})));
		},
	};
}

const noWait = async () => {};

describe("reading X Layer logs", () => {
	test("reads a range 100 blocks at a time and gives every log in chain order", async () => {
		const blocks = [1_000, 1_050, 1_150, 1_299];
		const a = node(blocks);
		const b = node(blocks);
		const read = await readLogs([a, b], {
			addresses: [FABX],
			fromBlock: 1_000n,
			toBlock: 1_299n,
		}, { sleep: noWait });
		expect(read.complete).toBe(true);
		if (!read.complete) return;
		const spans = [...a.calls, ...b.calls].sort((x, y) => Number(x[0] - y[0]));
		expect(spans).toEqual([
			[1_000n, 1_099n],
			[1_100n, 1_199n],
			[1_200n, 1_299n],
		]);
		expect(read.logs.map((l) => [l.blockNumber, l.logIndex])).toEqual([
			[1_000n, 0], [1_000n, 1],
			[1_050n, 0], [1_050n, 1],
			[1_150n, 0], [1_150n, 1],
			[1_299n, 0], [1_299n, 1],
		]);
		expect(read.logs[0]?.blockTimestamp).toBe(1_791_801_000n);
	});

	test("a piece refused over the rate limit is tried again, and no log is lost", async () => {
		const read = await readLogs([node([1_020, 1_120], { failFirst: 3 })], {
			addresses: [FABX],
			fromBlock: 1_000n,
			toBlock: 1_199n,
		}, { sleep: noWait });
		expect(read.complete).toBe(true);
		if (read.complete) expect(read.logs).toHaveLength(4);
	});

	test("a piece that keeps failing fails the whole read, naming its blocks, never a gap", async () => {
		const read = await readLogs([node([1_020], { failFirst: 1_000 })], {
			addresses: [FABX],
			fromBlock: 1_000n,
			toBlock: 1_099n,
		}, { sleep: noWait });
		expect(read).toEqual({
			complete: false,
			detail: "blocks 1000 to 1099: over rate limit, after 8 tries",
		});
	});
});
