import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseAddress, parseHex32 } from "@foreman/contract";
import {
	decodeAbiParameters,
	encodeAbiParameters,
	type Hex,
	hexToString,
	keccak256,
	stringToHex,
} from "viem";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/xlayer-published-result.json" with {
	type: "json",
};
import { ReadBackError, readPublishedResult, shortVerdict } from "./results.ts";

// ForemanResults on X Layer testnet, read on 23 Nov 2026 (CLAUDE.md, "Published result": a result
// written to X Layer decodes back to the same verdict, evidence, rule version and block). Circuit
// 0xb102…a14c/18387 was published in 0x19a2…af2a at block 46,918,536; the same transaction carries
// no result for circuit #1 on that processor.
const CONTRACT = parseAddress(
	"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
	"contract",
);
const X1 = parseAddress(
	"0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
	"processor",
);
const TX = parseHex32(fixture.tx, "tx");
const at = (circuitId: bigint, tx = TX) => ({
	chainId: 1952 as const,
	contract: CONTRACT,
	processor: X1,
	circuitId,
	tx,
	blockNumber: BigInt(fixture.block),
});

// The fixture's publish is in the shape from before 25 Nov 2026 (index.upToBlock, no mining).
// `amended` is the same publish rewritten in today's shape, with the contract storing its hash,
// as the republish leaves it (2026-11-25-republish-in-new-shape.md).
const PUBLISHED = [
	{ type: "uint8" },
	{ type: "uint8" },
	{ type: "uint64" },
	{ type: "bytes32" },
	{ type: "bytes" },
] as const;
const amended = (() => {
	let newHash = "";
	const calls = fixture.calls.map((c) => {
		if (c.method !== "eth_getTransactionReceipt" || !c.result) return c;
		const receipt = c.result as { logs: { data: Hex }[] };
		const logs = receipt.logs.map((l) => {
			const [kind, canMine, indexBlock, , result] = decodeAbiParameters(
				PUBLISHED,
				l.data,
			);
			const old = JSON.parse(hexToString(result));
			const { upToBlock, ...index } = old.index;
			const json = stringToHex(
				JSON.stringify({
					...old,
					mining:
						old.scope === "miner"
							? {
									chainId: 56,
									contract: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
								}
							: null,
					index: { ...index, upTo: [upToBlock] },
				}),
			);
			const hash = keccak256(json);
			if (old.circuit.tokenId === "18387") newHash = hash;
			return {
				...l,
				data: encodeAbiParameters(PUBLISHED, [
					kind,
					canMine,
					indexBlock,
					hash,
					json,
				]),
			};
		});
		return { ...c, result: { ...receipt, logs } };
	});
	return {
		...fixture,
		calls: calls.map((c) =>
			c.method === "eth_call" &&
			typeof c.result === "string" &&
			/[1-9a-f]/.test(c.result.slice(-64))
				? { ...c, result: c.result.replace(/[0-9a-f]{64}$/, newHash.slice(2)) }
				: c,
		),
	};
})();

describe("reading a published result back from X Layer", () => {
	test("a result published before 25 Nov 2026 is named as the earlier format, never as unreadable", async () => {
		await expect(
			readPublishedResult(replayClient(fixture), at(18387n)),
		).rejects.toMatchObject({ reason: "earlier-format" });
	});

	test("the logged result decodes to the circuit's verdict, rule and block, and the contract stores its hash", async () => {
		const read = await readPublishedResult(replayClient(amended), at(18387n));
		expect(read.readAt).toMatchObject({
			chainId: 1952,
			block: BigInt(fixture.block),
		});
		expect(read.publishedAt).toEqual({ block: 46_918_536n, tx: TX });
		expect(read.logged.circuit).toMatchObject({
			processor: X1,
			tokenId: 18387n,
		});
		expect(read.logged.result.verdict).toBe("too-small-to-tell");
		expect(read.logged.ruleVersion).toMatch(/^hash /);
		expect(read.stored).toEqual({
			...shortVerdict(read.logged),
			indexBlock: read.logged.index.upTo[0]?.block,
			resultHash: read.loggedHash,
		});
		expect(read.current).toBe(true);
		expect(read.shortVerdictAgrees).toBe(true);
	});

	test("when the contract stores a later result, this publish isn't called current", async () => {
		const later = `0x${"ab".repeat(32)}`;
		const replaced = {
			...amended,
			calls: amended.calls.map((c) =>
				c.method === "eth_call" && typeof c.result === "string"
					? { ...c, result: c.result.replace(/[0-9a-f]{64}$/, later.slice(2)) }
					: c,
			),
		};
		const read = await readPublishedResult(replayClient(replaced), at(18387n));
		expect(read.stored?.resultHash).toBe(later);
		expect(read.current).toBe(false);
	});

	test("a transaction with no result for this circuit says so, never a silent match", async () => {
		await expect(
			readPublishedResult(replayClient(fixture), at(1n)),
		).rejects.toMatchObject({ reason: "no-log" });
	});

	test("a transaction X Layer doesn't know says so", async () => {
		const unknown = parseHex32(`0x${"00".repeat(31)}01`, "tx");
		await expect(
			readPublishedResult(replayClient(fixture), at(18387n, unknown)),
		).rejects.toBeInstanceOf(ReadBackError);
		await expect(
			readPublishedResult(replayClient(fixture), at(18387n, unknown)),
		).rejects.toMatchObject({ reason: "no-transaction" });
	});

	test("a failed read rejects", async () => {
		await expect(
			readPublishedResult(replayClient({ ...fixture, calls: [] }), at(18387n)),
		).rejects.toThrow();
	});
});
