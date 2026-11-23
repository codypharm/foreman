import { replayClient } from "@foreman/chain-bnb/fixture";
import { parseAddress, parseHex32 } from "@foreman/contract";
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

describe("reading a published result back from X Layer", () => {
	test("the logged result decodes to the circuit's verdict, rule and block, and the contract stores its hash", async () => {
		const read = await readPublishedResult(replayClient(fixture), at(18387n));
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
			indexBlock: read.logged.index.upToBlock.block,
			resultHash: read.loggedHash,
		});
		expect(read.current).toBe(true);
		expect(read.shortVerdictAgrees).toBe(true);
	});

	test("when the contract stores a later result, this publish isn't called current", async () => {
		const later = `0x${"ab".repeat(32)}`;
		const replaced = {
			...fixture,
			calls: fixture.calls.map((c) =>
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
