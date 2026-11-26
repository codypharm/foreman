import { replayClient } from "@foreman/chain-bnb/fixture";
import { describe, expect, test } from "vitest";
import fabxNetlists from "../../index/fixtures/fabx-netlists-76847895.json" with {
	type: "json",
};
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import { checkWrapper, type Netlist, readNetlist } from "./index.ts";
import { withNetlist } from "./testing.ts";

// Real circuits at BNB block 134,673,279 (fixtures/README.md, "Wrappers and REF"). Rules:
// docs/decisions/2026-11-20-copy-and-wrapper-rules.md (decisions 5 and 6) and
// 2026-11-20-wrapper-targets-and-step-limit.md.
const AT = { blockNumber: 134_673_279n };
const client = replayClient(fixture);
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const WRAPS = "0xc1ae0d87cde4f93bcae38c6d62a269c76d5d3215";

async function netlist(processor: `0x${string}`, id: bigint): Promise<Netlist> {
	const read = await readNetlist(client, { processor, id }, AT);
	if (!read.readable) throw new Error(read.detail);
	return read.netlist;
}

describe("checking a netlist for REF records", () => {
	test("names a pure wrapper's target and where its chain ends", async () => {
		expect(await checkWrapper(client, await netlist(P0, 6534n), AT)).toEqual({
			kind: "wrapper",
			pointsTo: [{ processor: P0, id: 5388n }],
			finalTargets: [{ processor: P0, id: 5388n }],
			chainSteps: 1,
		});
	});

	test("stops a chain at the first circuit with gates of its own, even if it also has REF records", async () => {
		// MINE6/42 → MINE6/3, which has 176 NANDs and 2 REFs to P0/1: the chain ends at /3
		expect(await checkWrapper(client, await netlist(MINE6, 42n), AT)).toEqual({
			kind: "wrapper",
			pointsTo: [{ processor: MINE6, id: 3n }],
			finalTargets: [{ processor: MINE6, id: 3n }],
			chainSteps: 1,
		});
	});

	test("follows a wrapper of a wrapper to the gates", async () => {
		// None exists on chain (fixtures/README.md), so the top link is made by pointing
		// a copy of WRAPS/106's REF record at WRAPS/106 itself: made → WRAPS/106 → MINE6/512
		const wraps106 = await netlist(WRAPS, 106n);
		const made = repointed(wraps106, { processor: WRAPS, id: 106n });
		expect(await checkWrapper(client, made, AT)).toEqual({
			kind: "wrapper",
			pointsTo: [{ processor: WRAPS, id: 106n }],
			finalTargets: [{ processor: MINE6, id: 512n }],
			chainSteps: 2,
		});
	});
});

describe("a wrapper of several circuits", () => {
	test("lists every target and every circuit where a chain ends", async () => {
		// None exists on chain (fixtures/README.md), so it is made from real records: P0/6534's
		// REF to P0/5388 (gates), plus WRAPS/106's REF re-pointed at WRAPS/106 (→ MINE6/512)
		const toGates = (await netlist(P0, 6534n)).records;
		const toWrapper = repointed(await netlist(WRAPS, 106n), {
			processor: WRAPS,
			id: 106n,
		}).records;
		const made: Netlist = {
			...(await netlist(P0, 6534n)),
			id: 0n,
			records: [...toGates, ...toWrapper],
		};
		expect(await checkWrapper(client, made, AT)).toEqual({
			kind: "wrapper",
			pointsTo: [
				{ processor: P0, id: 5388n },
				{ processor: WRAPS, id: 106n },
			],
			finalTargets: [
				{ processor: P0, id: 5388n },
				{ processor: MINE6, id: 512n },
			],
			chainSteps: 2,
		});
	});
});

describe("REF records that don't make a wrapper", () => {
	test("calls REF records mixed with real gates a fact, with how many gates are borrowed", async () => {
		// MINE6/3: 176 NANDs of its own and 2 REFs to P0/1 (1,204 gates each); circuitInfo
		// counts 2,584 gates, so 2,408 come from P0/1
		expect(await checkWrapper(client, await netlist(MINE6, 3n), AT)).toEqual({
			kind: "uses-ref",
			refRecords: 2,
			targets: [{ processor: P0, id: 1n }],
			borrowedGates: 2408,
			totalGates: 2584,
		});
	});

	test("says nothing about REF for a netlist without any", async () => {
		expect(await checkWrapper(client, await netlist(MINE6, 153n), AT)).toEqual({
			kind: "no-ref",
		});
	});

	test("names one target for a wrapper of many REF records to the same circuit", async () => {
		// MINE6/68: 128 REF records, all to MINE6/1
		expect(await checkWrapper(client, await netlist(MINE6, 68n), AT)).toEqual({
			kind: "wrapper",
			pointsTo: [{ processor: MINE6, id: 1n }],
			finalTargets: [{ processor: MINE6, id: 1n }],
			chainSteps: 1,
		});
	});
});

describe("chains Foreman can't follow to the end", () => {
	test("calls a chain past 10 steps can't check, and never loops", async () => {
		// The chain can't hold a loop (a REF names a circuit that already exists), but bad
		// data could: WRAPS/106's saved bytes are changed to one REF to WRAPS/106 itself
		const loop = `0x02${WRAPS.slice(2)}000000000000006a0001`;
		const looped = replayClient(withNetlist(fixture, WRAPS, 106n, loop));
		const made = repointed(await netlist(WRAPS, 106n), {
			processor: WRAPS,
			id: 106n,
		});
		expect(await checkWrapper(looped, made, AT)).toEqual({
			kind: "cant-check",
			reason: "ref-chain-too-long",
			detail: expect.any(String),
		});
	});

	// Ten fixture circuits rewritten into a chain, each one REF to the next; the last
	// points at `end`. Only the saved bytes change (testing.ts).
	const NODES = [
		1008n,
		1144n,
		1147n,
		1510n,
		1570n,
		967n,
		1784n,
		2397n,
		2510n,
		2683n,
	];
	const ref = (to: bigint) =>
		`0x02${MINE6.slice(2)}${to.toString(16).padStart(16, "0")}0001`;
	function chain(nodes: bigint[], end: bigint) {
		let f = fixture as Parameters<typeof replayClient>[0];
		nodes.forEach((id, i) => {
			f = withNetlist(f, MINE6, id, ref(nodes[i + 1] ?? end));
		});
		return replayClient(f);
	}
	test("follows a chain that reaches the gates at exactly step 10", async () => {
		// made → 9 wrappers → MINE6/512: the gates are reached at step 10
		const nine = NODES.slice(0, 9);
		const made = repointed(await netlist(WRAPS, 106n), {
			processor: MINE6,
			id: nine[0] as bigint,
		});
		const result = await checkWrapper(chain(nine, 512n), made, AT);
		expect(result).toMatchObject({
			kind: "wrapper",
			chainSteps: 10,
			finalTargets: [{ processor: MINE6, id: 512n }],
		});
	});

	test("calls a chain still wrapping at step 10 can't check", async () => {
		// made → 10 wrappers → MINE6/512: step 10 is still a wrapper
		const made = repointed(await netlist(WRAPS, 106n), {
			processor: MINE6,
			id: NODES[0] as bigint,
		});
		expect(await checkWrapper(chain(NODES, 512n), made, AT)).toMatchObject({
			kind: "cant-check",
			reason: "ref-chain-too-long",
		});
	});

	test("calls a chain whose target can't be read can't check, never where the gates are", async () => {
		// WRAPS/106 points at MINE6/512, whose saved bytes are made unreadable
		const broken = replayClient(withNetlist(fixture, MINE6, 512n, "0x07"));
		expect(await checkWrapper(broken, await netlist(WRAPS, 106n), AT)).toEqual({
			kind: "cant-check",
			reason: "netlist-unreadable",
			detail: expect.stringContaining("512"),
		});
	});

	test("calls a chain whose target isn't there can't check", async () => {
		const made = repointed(await netlist(WRAPS, 106n), {
			processor: MINE6,
			id: 999_999n,
		});
		expect(await checkWrapper(client, made, AT)).toEqual({
			kind: "cant-check",
			reason: "read-failed",
			detail: expect.stringContaining("999999"),
		});
	});
});

/** A netlist like `n` whose REF records all point at `target` (made, not on chain). */
function repointed(
	n: Netlist,
	target: { processor: `0x${string}`; id: bigint },
): Netlist {
	return {
		...n,
		id: 0n,
		records: n.records.map((r) => (r.op === "ref" ? { ...r, target } : r)),
	};
}

describe("following a chain through netlists already read", () => {
	// FabX's only two wrappers, #6147 and #6053, at X Layer block 76,847,895
	// (packages/index/fixtures/fabx-netlists-76847895.json)
	const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";
	const XL = { blockNumber: 76_847_895n };
	const xlayer = replayClient(fabxNetlists);
	const read = (id: bigint) => readNetlist(xlayer, { processor: FABX, id }, XL);

	test("names a FabX wrapper's target from the netlists it is given, reading no node", async () => {
		const own = await read(6147n);
		if (!own.readable) throw new Error(own.detail);
		const asked: bigint[] = [];
		const source = (t: { processor: `0x${string}`; id: bigint }) => {
			asked.push(t.id);
			return read(t.id);
		};
		expect(await checkWrapper(source, own.netlist, XL)).toEqual({
			kind: "wrapper",
			pointsTo: [{ processor: FABX, id: 4206n }],
			finalTargets: [{ processor: FABX, id: 4206n }],
			chainSteps: 1,
		});
		expect(asked).toEqual([4206n]);
	});

	test("a target the source can't give is Can't check, never a wrapper with no target", async () => {
		const own = await read(6053n);
		if (!own.readable) throw new Error(own.detail);
		const none = async () =>
			({
				readable: false,
				reason: "read-failed",
				detail: "not in the index",
			}) as const;
		expect(await checkWrapper(none, own.netlist, XL)).toMatchObject({
			kind: "cant-check",
			reason: "read-failed",
		});
	});
});
