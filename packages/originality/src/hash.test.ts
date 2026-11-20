import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { hashNetlist, type Netlist, readNetlist } from "./index.ts";

// Real circuits at BNB block 134,673,279 (fixtures/README.md, "Swapped NAND inputs").
const AT = { blockNumber: 134_673_279n };
const client = replayClient(fixture);
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

async function netlist(processor: `0x${string}`, id: bigint): Promise<Netlist> {
	const read = await readNetlist(client, { processor, id }, AT);
	if (!read.readable)
		throw new Error(`${processor}/${id} is unreadable in the fixture`);
	return read.netlist;
}

describe("hashing a netlist", () => {
	test("gives two netlists that differ only by swapped NAND inputs the same netlist hash", async () => {
		const a = hashNetlist(await netlist(MINE6, 1510n));
		const b = hashNetlist(await netlist(MINE6, 1570n));
		expect(a.netlistHash).toBe(b.netlistHash);
		expect(a.byteHash).not.toBe(b.byteHash);
	});

	test("gives byte-identical netlists on different processors the same hashes", async () => {
		// The 1,204-gate circuit taped out on three processors
		const hashes = await Promise.all(
			[
				["0x50a994e71615474b55559ff4f500928fbc339dd9", 1n],
				["0x54840f62c9d6cf322a3972a6be0be16e76077cc0", 1n],
				["0xd3c3a93ca6cacc50b303cac1e51580cd95632509", 3n],
			].map(async ([p, id]) =>
				hashNetlist(await netlist(p as `0x${string}`, id as bigint)),
			),
		);
		expect(new Set(hashes.map((h) => h.netlistHash)).size).toBe(1);
		expect(new Set(hashes.map((h) => h.byteHash)).size).toBe(1);
	});

	test("tells apart a netlist with one input changed, not swapped", async () => {
		// MINE6/512: LATCH d=3, NAND(2, 2). Point the NAND's second input at signal 3 instead.
		const real = await netlist(MINE6, 512n);
		const changed: Netlist = {
			...real,
			bytes: "0x0100000300000002000003",
			records: [
				{ op: "latch", d: 3 },
				{ op: "nand", a: 2, b: 3 },
			],
		};
		expect(hashNetlist(changed).netlistHash).not.toBe(
			hashNetlist(real).netlistHash,
		);
	});

	test("tells apart the same bytes with a different number of inputs or outputs", async () => {
		const real = await netlist(MINE6, 1570n);
		const more = { ...real, nOut: real.nOut + 1 };
		const fewer = { ...real, nIn: real.nIn + 1 };
		expect(hashNetlist(more).netlistHash).not.toBe(
			hashNetlist(real).netlistHash,
		);
		expect(hashNetlist(fewer).netlistHash).not.toBe(
			hashNetlist(real).netlistHash,
		);
	});
});
