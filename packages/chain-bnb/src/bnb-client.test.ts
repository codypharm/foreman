import { createPublicClient, custom, numberToHex } from "viem";
import { describe, expect, test } from "vitest";
import { bnbTransport } from "./index.ts";

// The BNB client's routing (docs/decisions/2026-11-21-bnb-nodes.md): reads and logs within 5,000
// blocks of the head go to the recent node (logs in 200-block chunks); older ones go to the archive
// node (logs in 10-block chunks). Two in-memory nodes stand in for publicnode and Alchemy: each logs
// what it was asked and answers one log per block.

const HEAD = 134_900_000n;

interface Asked {
	method: string;
	from?: bigint;
	to?: bigint;
}

function node(
	name: string,
	asked: Asked[],
	opts: { failAt?: bigint | undefined } = {},
) {
	return custom({
		async request({ method, params }) {
			if (method === "eth_blockNumber") {
				asked.push({ method });
				return numberToHex(HEAD);
			}
			if (method === "eth_getLogs") {
				const [filter] = params as [{ fromBlock: string; toBlock: string }];
				const from = BigInt(filter.fromBlock);
				const to = BigInt(filter.toBlock);
				asked.push({ method, from, to });
				if (
					opts.failAt !== undefined &&
					from <= opts.failAt &&
					opts.failAt <= to
				) {
					throw new Error(`${name} failed`);
				}
				const logs = [];
				for (let b = from; b <= to; b++) {
					logs.push({
						blockNumber: numberToHex(b),
						logIndex: "0x0",
						node: name,
					});
				}
				return logs;
			}
			asked.push({ method });
			return `${name}:${method}`;
		},
	});
}

function setUp(
	opts: { recentFailAt?: bigint; archiveLogBlocks?: bigint } = {},
) {
	const archiveAsked: Asked[] = [];
	const recentAsked: Asked[] = [];
	const client = createPublicClient({
		transport: bnbTransport({
			archive: node("archive", archiveAsked),
			recent: node("recent", recentAsked, { failAt: opts.recentFailAt }),
			...(opts.archiveLogBlocks
				? { archiveLogBlocks: opts.archiveLogBlocks }
				: {}),
		}),
	});
	const getLogs = (from: bigint, to: bigint) =>
		client.request({
			method: "eth_getLogs",
			params: [{ fromBlock: numberToHex(from), toBlock: numberToHex(to) }],
		}) as Promise<{ blockNumber: string; node: string }[]>;
	const ranges = (asked: Asked[]) =>
		asked.filter((a) => a.method === "eth_getLogs").map((a) => [a.from, a.to]);
	/** A call to the mining contract at one block or tag. */
	const callAt = (block: string) =>
		client.request({
			method: "eth_call",
			params: [
				{
					to: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
					data: "0xef6aff46",
				},
				block,
			],
		} as never);
	const methods = (asked: Asked[]) =>
		asked.map((a) => a.method).filter((m) => m !== "eth_blockNumber");
	return {
		client,
		getLogs,
		callAt,
		archiveAsked,
		recentAsked,
		ranges,
		methods,
	};
}

describe("the BNB client", () => {
	test("a read at a recent block, or at a tag like latest or finalized, goes to the recent node", async () => {
		const { client, callAt, archiveAsked, recentAsked, methods } = setUp();
		expect(await callAt(numberToHex(HEAD - 4_999n))).toBe("recent:eth_call");
		expect(await callAt("latest")).toBe("recent:eth_call");
		expect(
			await client.request({
				method: "eth_getBlockByNumber",
				params: ["finalized", false],
			} as never),
		).toBe("recent:eth_getBlockByNumber");
		expect(methods(recentAsked)).toEqual([
			"eth_call",
			"eth_call",
			"eth_getBlockByNumber",
		]);
		expect(methods(archiveAsked)).toEqual([]);
	});

	test("a read older than 5,000 blocks goes to the archive node", async () => {
		const { client, callAt, archiveAsked, recentAsked, methods } = setUp();
		expect(await callAt(numberToHex(HEAD - 5_001n))).toBe("archive:eth_call");
		expect(
			await client.request({
				method: "eth_getBlockByNumber",
				params: [numberToHex(HEAD - 20_000n), false],
			} as never),
		).toBe("archive:eth_getBlockByNumber");
		expect(methods(archiveAsked)).toEqual(["eth_call", "eth_getBlockByNumber"]);
		expect(methods(recentAsked)).toEqual([]);
	});

	test("a read with no block, such as a receipt by hash, goes to the archive node, which has all history", async () => {
		const { client, recentAsked, methods } = setUp();
		expect(
			await client.request({
				method: "eth_getTransactionReceipt",
				params: [`0x${"ab".repeat(32)}`],
			} as never),
		).toBe("archive:eth_getTransactionReceipt");
		expect(methods(recentAsked)).toEqual([]);
	});

	test("recent logs come from the recent node in 200-block chunks, joined in block order", async () => {
		const { getLogs, ranges, recentAsked, archiveAsked } = setUp();
		const from = HEAD - 449n;
		const logs = await getLogs(from, HEAD);
		expect(ranges(recentAsked)).toEqual([
			[from, from + 199n],
			[from + 200n, from + 399n],
			[from + 400n, HEAD],
		]);
		expect(ranges(archiveAsked)).toEqual([]);
		expect(logs.map((l) => BigInt(l.blockNumber))).toEqual(
			Array.from({ length: 450 }, (_, i) => from + BigInt(i)),
		);
		expect(new Set(logs.map((l) => l.node))).toEqual(new Set(["recent"]));
	});

	test("logs older than 5,000 blocks come from the archive node in 10-block chunks", async () => {
		const { getLogs, ranges, recentAsked, archiveAsked } = setUp();
		const from = HEAD - 6_000n;
		const logs = await getLogs(from, from + 24n);
		expect(ranges(archiveAsked)).toEqual([
			[from, from + 9n],
			[from + 10n, from + 19n],
			[from + 20n, from + 24n],
		]);
		expect(ranges(recentAsked)).toEqual([]);
		expect(logs).toHaveLength(25);
	});

	test("an archive node that reads more blocks at once (NodeReal: 50,000) gets chunks of that size", async () => {
		const { getLogs, ranges, archiveAsked } = setUp({
			archiveLogBlocks: 50_000n,
		});
		const from = HEAD - 120_000n;
		const logs = await getLogs(from, HEAD - 5_001n);
		expect(ranges(archiveAsked)).toEqual([
			[from, from + 49_999n],
			[from + 50_000n, from + 99_999n],
			[from + 100_000n, HEAD - 5_001n],
		]);
		expect(logs).toHaveLength(114_999 + 1);
	});

	test("a range crossing the line is split at it, every block read once, in order", async () => {
		const { getLogs, ranges, recentAsked, archiveAsked } = setUp();
		const line = HEAD - 5_000n;
		const logs = await getLogs(line - 15n, line + 250n);
		expect(ranges(archiveAsked)).toEqual([
			[line - 15n, line - 6n],
			[line - 5n, line - 1n],
		]);
		expect(ranges(recentAsked)).toEqual([
			[line, line + 199n],
			[line + 200n, line + 250n],
		]);
		expect(logs.map((l) => BigInt(l.blockNumber))).toEqual(
			Array.from({ length: 266 }, (_, i) => line - 15n + BigInt(i)),
		);
	});

	test("many reads at once share one head read, never one each (21 Nov 2026: 2,329 head reads for 300 listings, and publicnode's HTTP 429)", async () => {
		const { callAt, recentAsked } = setUp();
		await Promise.all(
			Array.from({ length: 200 }, () => callAt(numberToHex(HEAD - 10n))),
		);
		await callAt(numberToHex(HEAD - 10n));
		expect(
			recentAsked.filter((a) => a.method === "eth_blockNumber"),
		).toHaveLength(1);
	});

	test("a failed chunk fails the whole read, never a partial list", async () => {
		const { getLogs } = setUp({ recentFailAt: HEAD - 100n });
		await expect(getLogs(HEAD - 449n, HEAD)).rejects.toThrow("recent failed");
	});
});
