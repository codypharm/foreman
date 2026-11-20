import { type Fixture, replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { readNetlist } from "./index.ts";

// Real circuits at BNB block 134,673,279 (20 Nov 2026), listed in fixtures/README.md. The
// expected records were decoded from the saved responses by a separate decoder, not this one.
const AT = { blockNumber: 134_673_279n };
const client = replayClient(fixture);
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";

describe("reading a circuit's netlist", () => {
	test("gives its shape and its records in order", async () => {
		// One LATCH (signal 2, fed by signal 3) and one NAND of signal 2 with itself
		expect(
			await readNetlist(client, { processor: MINE6, id: 512n }, AT),
		).toEqual({
			readable: true,
			netlist: {
				processor: MINE6,
				id: 512n,
				nIn: 0,
				nOut: 1,
				nState: 1,
				gateCount: 2,
				bytes: "0x0100000300000002000002",
				records: [
					{ op: "latch", d: 3 },
					{ op: "nand", a: 2, b: 2 },
				],
			},
		});
	});

	test("gives a REF record's target circuit and the signals wired to it", async () => {
		// A pure wrapper: one REF to P0/5388 (one NAND), fed by input signal 2
		const read = await readNetlist(client, { processor: P0, id: 6534n }, AT);
		expect(read.readable && read.netlist.records).toEqual([
			{
				op: "ref",
				target: { processor: P0, id: 5388n },
				nIns: 1,
				nOuts: 1,
				inputs: [2],
			},
		]);
	});

	// The chain never returns these (tapeout checks every record), so they are made by
	// changing MINE6/512's saved bytes: 01 000003 | 00 000002 000002
	test.each([
		["a NAND cut off mid-record", "0x01000003000000020000"],
		["an unknown opcode", "0x01000003070000020000020000"],
		[
			"a REF whose inputs run past the end",
			"0x0250a994e71615474b55559ff4f500928fbc339dd9000000000000150c0201000002",
		],
	])("calls %s unreadable, never a netlist", async (_, bytes) => {
		const corrupt = replayClient(withNetlist(fixture, MINE6, 512n, bytes));
		expect(
			await readNetlist(corrupt, { processor: MINE6, id: 512n }, AT),
		).toEqual({
			readable: false,
			reason: "netlist-unreadable",
			detail: expect.any(String),
		});
	});
});

describe("every circuit in the fixture", () => {
	// Each eth_call to netlist(id) in the fixture, as [processor, id]
	const circuits = fixture.calls.flatMap((c) => {
		const p = c.params[0] as { to?: string; data?: string };
		return c.method === "eth_call" && p.data?.startsWith("0x3fc4be56")
			? [[p.to as `0x${string}`, BigInt(`0x${p.data.slice(10)}`)] as const]
			: [];
	});

	test("is all 33 circuits", () => {
		expect(circuits).toHaveLength(33);
	});

	test.each(circuits)(
		"%s/%s decodes, and without REF its gates match the chain's count",
		async (processor, id) => {
			const read = await readNetlist(client, { processor, id }, AT);
			if (!read.readable) throw new Error(read.detail);
			const { records, gateCount } = read.netlist;
			if (records.every((r) => r.op !== "ref"))
				expect(records).toHaveLength(gateCount);
		},
	);
});

describe("when the chain can't be read", () => {
	test("says the read failed, never a netlist and never a crash", async () => {
		// The replay client refuses calls it has no saved answer for, as a dead node would
		expect(
			await readNetlist(client, { processor: MINE6, id: 999_999n }, AT),
		).toEqual({
			readable: false,
			reason: "read-failed",
			detail: expect.stringContaining("999999"),
		});
	});
});

/** A copy of the fixture whose saved netlist(id) response holds other bytes. */
function withNetlist(
	f: Fixture,
	processor: string,
	id: bigint,
	bytes: string,
): Fixture {
	const data = `0x3fc4be56${id.toString(16).padStart(64, "0")}`;
	const body = bytes.slice(2);
	const len = (body.length / 2).toString(16).padStart(64, "0");
	const padded = body.padEnd(Math.ceil(body.length / 64) * 64, "0");
	const result = `0x${"20".padStart(64, "0")}${len}${padded}`;
	let replaced = 0;
	const calls = f.calls.map((c) => {
		const p = (c.params as unknown[])[0] as { to?: string; data?: string };
		if (c.method !== "eth_call" || p.to !== processor || p.data !== data)
			return c;
		replaced++;
		return { ...c, result };
	});
	if (replaced !== 1)
		throw new Error(
			`expected one saved netlist(${id}) call, found ${replaced}`,
		);
	return { ...f, calls };
}
