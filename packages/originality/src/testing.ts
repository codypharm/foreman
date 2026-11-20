// Test helpers: changed copies of a saved fixture, for cases the chain never produces.

import { type Fixture, replayClient } from "@foreman/chain-bnb/fixture";
import { type Address, decodeFunctionResult, type Hex, parseAbi } from "viem";
import fixture from "../fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type { CircuitIndex, IndexEntry } from "./check-copy.ts";
import { hashNetlist } from "./hash.ts";
import { readNetlist } from "./read-netlist.ts";

/** A copy of the fixture whose saved netlist(id) response holds other bytes. */
export function withNetlist(
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

/**
 * The fixture's 33 circuits as index entries, built from their saved responses: the netlist
 * and its hashes, the TapedOut log, and getMiner's commitBlock. The real index reader is
 * not built yet (CLAUDE.md, "Still open": how to index every circuit).
 */
export async function fixtureIndex(): Promise<CircuitIndex> {
	const client = replayClient(fixture);
	const at = { blockNumber: BigInt(fixture.block) };
	const calls = fixture.calls as {
		method: string;
		params: unknown[];
		result: unknown;
	}[];

	const tapeOuts = new Map<
		string,
		{ block: bigint; txIndex: number; logIndex: number; by: Address }
	>();
	const commits = new Map<string, bigint>();
	for (const c of calls) {
		const p = c.params[0] as {
			address?: string;
			to?: string;
			data?: string;
			topics?: string[];
		};
		if (c.method === "eth_getLogs" && p.topics?.[0] === TAPED_OUT) {
			for (const log of c.result as {
				address: string;
				topics: string[];
				blockNumber: string;
				transactionIndex: string;
				logIndex: string;
			}[]) {
				tapeOuts.set(
					`${log.address.toLowerCase()}/${BigInt(log.topics[1] as string)}`,
					{
						block: BigInt(log.blockNumber),
						txIndex: Number(log.transactionIndex),
						logIndex: Number(log.logIndex),
						by: `0x${(log.topics[2] as string).slice(26)}` as Address,
					},
				);
			}
		}
		if (c.method === "eth_call" && p.data?.startsWith(GET_MINER)) {
			const m = decodeFunctionResult({
				abi: getMinerAbi,
				functionName: "getMiner",
				data: c.result as Hex,
			});
			if (m.commitBlock > 0n)
				commits.set(
					`${m.circuits.toLowerCase()}/${m.circuitId}`,
					m.commitBlock,
				);
		}
	}

	const entries: IndexEntry[] = [];
	for (const [k, t] of tapeOuts) {
		const [processor, id] = k.split("/") as [Address, string];
		const read = await readNetlist(client, { processor, id: BigInt(id) }, at);
		if (!read.readable) throw new Error(read.detail);
		entries.push({
			circuit: { processor, id: BigInt(id) },
			...hashNetlist(read.netlist),
			gateCount: read.netlist.gateCount,
			tapedOutAt: { block: t.block, txIndex: t.txIndex, logIndex: t.logIndex },
			tapedOutBy: t.by,
			designCommittedAt: commits.get(k) ?? null,
		});
	}
	return { entries, upToBlock: at.blockNumber };
}

const TAPED_OUT =
	"0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031";
const GET_MINER = "0x0527edc2";
const getMinerAbi = parseAbi([
	"function getMiner(bytes32 key) view returns ((address circuits, uint64 circuitId, uint32 taskId, uint32 gateCount, uint32 stateCount, uint32 depth, uint64 area, uint32 mult, uint64 since, uint8 status, address registrant, uint32 nandBurn, uint32 latchBurn, uint64 bstar, uint64 bonus, bool optimal, uint64 commitBlock, uint64 firstUnusedId, uint64 stopBlock, uint128 verifWeight, uint128 unverWeight, uint256 debt))",
]);
