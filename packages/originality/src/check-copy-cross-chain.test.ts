import { parseHex32 } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import {
	type CircuitIndex,
	checkCopy,
	type IndexEntry,
	originalityVerdict,
} from "./index.ts";

// The copy check across BNB Chain and FabX's processor on X Layer (2026-11-25-fabx-copy-check.md,
// decisions 4 and 5; 2026-11-25-cross-chain-check.md). Values are real, read on 25 Nov 2026:
// BNB Chain #97 and FabX #24 share a 140-gate netlist; FabX #302, #943 and #3046 share a 17-gate
// one, and FabX reports commitments for #302 and #3046 that have no DesignCommitted event.
// Cases marked "made up" move one value to reach a rule the real data doesn't.

const BNB = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";
const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";
const hash = (h: string) => parseHex32(`0x${h}`, "hash");
const H140 = hash(
	"b546f5b9789f61b5a9a497a5545356df53317cf36919a934925411ffdf19184c",
);
const B140 = hash(
	"0e554c4a3544ea14ffc67a727a17180d95f62f37c9c64fbe1f784e7a7ed76daa",
);
// #302's netlist and byte hashes are the same: no NAND inputs to put in order
const H17 = hash(
	"f75821de405f9d926028de362729f025d4a5e8cb0cd0da22fed23bf9d867cad7",
);
const B17 = H17;
const RULES = { sizeFloor: 4 };

function entry(
	chainId: 56 | 196,
	id: bigint,
	tapedOut: [block: bigint, tx: number, log: number, time: bigint],
	more: Partial<IndexEntry> = {},
): IndexEntry {
	const [block, txIndex, logIndex, time] = tapedOut;
	return {
		chainId,
		circuit: { processor: chainId === 56 ? BNB : FABX, id },
		netlistHash: H140,
		byteHash: B140,
		gateCount: 140,
		tapedOutAt: { block, txIndex, logIndex, time },
		tapedOutBy: `0x${String(id).padStart(40, "0")}`,
		miner: true,
		designCommittedAt: null,
		unconfirmedCommitment: null,
		...more,
	};
}

const BNB_97 = entry(56, 97n, [116_187_134n, 30, 215, 1_786_844_921n], {
	miner: false,
});
const FABX_24 = entry(196, 24n, [73_044_971n, 22, 91, 1_791_814_007n]);
const UP_TO = [
	{ chainId: 56 as const, block: 134_600_000n },
	{ chainId: 196 as const, block: 76_847_895n },
];
const index = (...entries: IndexEntry[]): CircuitIndex => ({
	entries,
	upTo: UP_TO,
});

describe("copies across chains", () => {
	test("a FabX circuit identical to a BNB Chain circuit taped out months before is its copy", () => {
		expect(
			checkCopy(FABX_24.circuit, index(BNB_97, FABX_24), RULES),
		).toMatchObject({
			kind: "copy",
			of: { chainId: 56, circuit: BNB_97.circuit },
			bytesIdentical: true,
			earlierBy: "tape-out",
		});
	});

	test("the earlier one is never called a copy, and coverage names both chains", () => {
		expect(checkCopy(BNB_97.circuit, index(BNB_97, FABX_24), RULES)).toEqual({
			kind: "no-earlier-copy",
			circuitsChecked: 2,
			upTo: UP_TO,
		});
	});

	test("is ordered by the second, never by block number: X Layer's lower block isn't earlier", () => {
		// made up: BNB #97 taped out one second after FabX #24, at a far higher block number
		const later = {
			...BNB_97,
			tapedOutAt: { ...BNB_97.tapedOutAt, time: 1_791_814_008n },
		};
		expect(
			checkCopy(later.circuit, index(later, FABX_24), RULES),
		).toMatchObject({
			kind: "copy",
			of: { chainId: 196, circuit: FABX_24.circuit },
		});
	});

	test("the same second on two chains is neither's copy", () => {
		// made up: BNB #97 in the same second as FabX #24
		const same = {
			...BNB_97,
			tapedOutAt: { ...BNB_97.tapedOutAt, time: 1_791_814_007n },
		};
		const both = index(same, FABX_24);
		expect(checkCopy(same.circuit, both, RULES).kind).toBe("no-earlier-copy");
		expect(checkCopy(FABX_24.circuit, both, RULES).kind).toBe(
			"no-earlier-copy",
		);
	});

	test("a confirmed commitment's own second decides across chains", () => {
		// made up: FabX #24 committed, confirmed by its event, a second before BNB #97's tape-out
		const committed = {
			...FABX_24,
			designCommittedAt: { block: 60_000_000n, time: 1_786_844_920n },
		};
		expect(
			checkCopy(BNB_97.circuit, index(BNB_97, committed), RULES),
		).toMatchObject({
			kind: "copy",
			of: { chainId: 196, circuit: FABX_24.circuit },
			earlierBy: "commitment",
		});
	});
});

describe("a FabX commitment without its event", () => {
	const at = (block: bigint, time: bigint) => ({ block, time });
	const seventeen = { netlistHash: H17, byteHash: B17, gateCount: 17 };
	// #302: taped out 73,053,984; FabX reports a commitment at 73,053,971, with no event
	const F302 = entry(196, 302n, [73_053_984n, 7, 16, 1_791_823_020n], {
		...seventeen,
		unconfirmedCommitment: at(73_053_971n, 1_791_823_007n),
	});
	// #943: committed at 73,107,378, confirmed by its event
	const F943 = entry(196, 943n, [73_107_382n, 6, 21, 1_791_876_418n], {
		...seventeen,
		designCommittedAt: at(73_107_378n, 1_791_876_414n),
	});
	// #3046: taped out 73,204,753; FabX reports a commitment at 73,050,416, with no event
	const F3046 = entry(196, 3046n, [73_204_753n, 5, 10, 1_791_973_789n], {
		...seventeen,
		unconfirmedCommitment: at(73_050_416n, 1_791_819_452n),
	});
	const group = index(F302, F943, F3046);

	test("is Can't check when it would make the circuit itself earlier than another", () => {
		// Counted, #3046's claim would put it before #302 and #943
		expect(checkCopy(F3046.circuit, group, RULES)).toMatchObject({
			kind: "cant-check",
			reason: "commitment-unconfirmed",
		});
	});

	test("is Can't check when another circuit's would change the circuit named", () => {
		// #943 is a copy of #302 by tape-out; counted, #3046's claim would make it the earliest
		expect(checkCopy(F943.circuit, group, RULES)).toMatchObject({
			kind: "cant-check",
			reason: "commitment-unconfirmed",
		});
	});

	test("decides nothing when counting it wouldn't change the verdict or the circuit named", () => {
		// Without #3046, #302's claim (13 blocks before its tape-out) moves it past nothing
		const pair = index(F302, F943);
		expect(checkCopy(F943.circuit, pair, RULES)).toMatchObject({
			kind: "copy",
			of: { circuit: F302.circuit },
			earlierBy: "tape-out",
		});
		expect(checkCopy(F302.circuit, pair, RULES).kind).toBe("no-earlier-copy");
	});

	test("is Can't check for a BNB Chain circuit too, when it would change that result", () => {
		// made up: FabX #24 claims, without an event, a second before BNB #97's tape-out
		const claims = {
			...FABX_24,
			unconfirmedCommitment: at(60_000_000n, 1_786_844_920n),
		};
		expect(
			checkCopy(BNB_97.circuit, index(BNB_97, claims), RULES),
		).toMatchObject({
			kind: "cant-check",
			reason: "commitment-unconfirmed",
		});
		// And for FabX #24: counted, its own claim would make it the earlier one
		expect(
			checkCopy(FABX_24.circuit, index(BNB_97, claims), RULES),
		).toMatchObject({
			kind: "cant-check",
			reason: "commitment-unconfirmed",
		});
	});
});

describe("the verdict across chains", () => {
	const plain = { kind: "no-ref" as const };

	test("names the earlier circuit's chain, and states the cross-chain rule and both chains' blocks", () => {
		const v = originalityVerdict({
			target: FABX_24.circuit,
			index: index(BNB_97, FABX_24),
			wrapper: plain,
		});
		expect(v.result).toMatchObject({
			verdict: "copy",
			of: { chainId: 56, tokenId: 97n },
		});
		expect(v.index).toEqual({ circuitsChecked: 2n, upTo: UP_TO });
		expect(v.ruleVersion).toBe(
			"hash 2026-11-20, floor 4, chain 10, BNB Chain and X Layer by second, FabX commitments by event",
		);
	});

	test("an index of BNB Chain alone keeps the BNB Chain rule", () => {
		const bnbOnly = {
			entries: [BNB_97],
			upTo: [UP_TO[0] as CircuitIndex["upTo"][number]],
		};
		expect(
			originalityVerdict({
				target: BNB_97.circuit,
				index: bnbOnly,
				wrapper: plain,
			}).ruleVersion,
		).toBe("hash 2026-11-20, floor 4, chain 10");
	});

	test("an unconfirmed commitment that would change the result is Can't check: commitment-unconfirmed", () => {
		const claims = {
			...FABX_24,
			unconfirmedCommitment: { block: 60_000_000n, time: 1_786_844_920n },
		};
		expect(
			originalityVerdict({
				target: BNB_97.circuit,
				index: index(BNB_97, claims),
				wrapper: plain,
			}).result,
		).toEqual({ verdict: "cant-check", reason: "commitment-unconfirmed" });
	});
});
