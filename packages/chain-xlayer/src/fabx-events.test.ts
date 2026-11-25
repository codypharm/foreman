import { describe, expect, test } from "vitest";
import fixture from "../fixtures/fabx-logs-sample.json" with { type: "json" };
import { decodeFabxLogs } from "./fabx-events.ts";
import type { XLayerLog } from "./read-logs.ts";

// One real log of each kind from FabX's processor and mining contract, read on 25 Nov 2026.
const logs: XLayerLog[] = fixture.logs.map((l) => ({
	address: l.address as XLayerLog["address"],
	topics: l.topics as XLayerLog["topics"],
	data: l.data as XLayerLog["data"],
	blockNumber: BigInt(l.blockNumber),
	transactionIndex: l.transactionIndex,
	logIndex: l.logIndex,
	transactionHash: l.transactionHash as XLayerLog["transactionHash"],
	blockTimestamp: BigInt(l.blockTimestamp),
}));
const kind = (k: string) => logs[fixture.logs.findIndex((l) => l._kind === k)]!;

describe("decoding FabX's logs", () => {
	test("gives tape-outs, commitments, starts and contract changes, and leaves the rest aside", () => {
		const h = decodeFabxLogs(logs);
		if (!h.ok) throw new Error(h.detail);
		expect(h.tapeOuts).toEqual([
			{
				processor: "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6",
				id: 24n,
				at: { block: 73_044_971n, tx: kind("tapeout24").transactionIndex, log: kind("tapeout24").logIndex },
				time: 1_791_814_007n,
				tapedOutBy: `0x${kind("tapeout24").topics[2]!.slice(26)}`,
			},
		]);
		expect(h.commitments.map((c) => [c.at.block, c.claimedBlock])).toEqual([
			[73_101_458n, 73_101_458n],
			[73_186_188n, BigInt(`0x${kind("dc_migrated").data.slice(2, 66)}`)],
		]);
		expect(h.commitments[1]!.claimedBlock).toBeLessThan(73_100_842n);
		expect(h.commitments[0]).toMatchObject({
			circuits: "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6",
			firstUnusedId: 785n,
		});
		expect(h.starts).toHaveLength(1);
		expect(h.starts[0]!.processor).toBe("0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6");
		expect(h.starts[0]!.registrant).toMatch(/^0x[0-9a-f]{40}$/);
		expect(h.contractEvents.map((e) => [e.kind, e.detail])).toEqual([
			["OwnershipTransferred", { from: "0x0000000000000000000000000000000000000000", to: "0xfb7708019e64462126bafffc30c03e770e455ef8" }],
			["ProcessorSet", { processor: "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6", multiplier: "6" }],
			["BoostSet", { boost: `0x${kind("boost").data.slice(26, 66)}` }],
			["Upgraded", { implementation: "0x90681776c2d6be4676d83fa8fef22836b5dbbeeb" }],
		]);
		expect(h.otherLogs).toBe(2); // a Transfer and a Claimed
	});

	test("a log without its block's time is refused, never given a guessed time", () => {
		const { blockTimestamp: _, ...noTime } = kind("tapeout24");
		expect(decodeFabxLogs([noTime])).toEqual({
			ok: false,
			detail: `block 73044971, log ${noTime.logIndex}: the node returned no block time`,
		});
	});
});
