// Test helpers: changed copies of a saved fixture, for cases the chain never produces.

import { type Fixture, replayClient } from "@foreman/chain-bnb/fixture";
import {
	type Address,
	createPublicClient,
	custom,
	decodeFunctionResult,
	type Hex,
	type PublicClient,
	parseAbi,
	zeroAddress,
} from "viem";
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
		{
			block: bigint;
			txIndex: number;
			logIndex: number;
			time: bigint;
			by: Address;
		}
	>();
	const commits = new Map<string, bigint>();
	const miners = new Set<string>();
	const blockTimes = new Map<bigint, bigint>();
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
				blockTimestamp: string;
			}[]) {
				tapeOuts.set(
					`${log.address.toLowerCase()}/${BigInt(log.topics[1] as string)}`,
					{
						block: BigInt(log.blockNumber),
						txIndex: Number(log.transactionIndex),
						logIndex: Number(log.logIndex),
						time: BigInt(log.blockTimestamp),
						by: `0x${(log.topics[2] as string).slice(26)}` as Address,
					},
				);
			}
		}
		if (c.method === "eth_getBlockByNumber") {
			const b = c.result as { number: string; timestamp: string };
			blockTimes.set(BigInt(b.number), BigInt(b.timestamp));
		}
		if (c.method === "eth_call" && p.data?.startsWith(GET_MINER)) {
			const m = decodeFunctionResult({
				abi: getMinerAbi,
				functionName: "getMiner",
				data: c.result as Hex,
			});
			if (m.circuits !== zeroAddress)
				miners.add(`${m.circuits.toLowerCase()}/${m.circuitId}`);
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
		const committed = commits.get(k);
		const committedTime =
			committed === undefined ? undefined : blockTimes.get(committed);
		if (committed !== undefined && committedTime === undefined)
			throw new Error(
				`the fixture has no block ${committed} for ${k}'s commitment`,
			);
		entries.push({
			circuit: { processor, id: BigInt(id) },
			...hashNetlist(read.netlist),
			gateCount: read.netlist.gateCount,
			tapedOutAt: {
				block: t.block,
				txIndex: t.txIndex,
				logIndex: t.logIndex,
				time: t.time,
			},
			tapedOutBy: t.by,
			miner: miners.has(k),
			designCommittedAt:
				committed === undefined
					? null
					: { block: committed, time: committedTime as bigint },
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

/** A copy of a tape-out scan fixture with one more TapedOut log, in the read that covers its block. */
export function withTapeOutLog(
	f: Fixture,
	log: {
		address: string;
		id: bigint;
		owner: string;
		block: bigint;
		txIndex: number;
		logIndex: number;
	},
): Fixture {
	const word = (n: bigint | string) =>
		`0x${BigInt(n).toString(16).padStart(64, "0")}`;
	const raw = {
		address: log.address,
		topics: [TAPED_OUT, word(log.id), word(log.owner)],
		data: `0x${"0".repeat(128)}`,
		blockNumber: `0x${log.block.toString(16)}`,
		transactionHash: `0x${"ab".repeat(32)}`,
		transactionIndex: `0x${log.txIndex.toString(16)}`,
		blockHash: `0x${"cd".repeat(32)}`,
		logIndex: `0x${log.logIndex.toString(16)}`,
		removed: false,
	};
	let added = 0;
	const calls = f.calls.map((c) => {
		if (c.method !== "eth_getLogs") return c;
		const p = (c.params as { fromBlock: string; toBlock: string }[])[0];
		if (!p || log.block < BigInt(p.fromBlock) || log.block > BigInt(p.toBlock))
			return c;
		added++;
		return { ...c, result: [...(c.result as unknown[]), raw] };
	});
	if (added !== 1)
		throw new Error(
			`expected one log read covering block ${log.block}, found ${added}`,
		);
	return { ...f, calls };
}

/** A copy of a tape-out scan fixture missing one processor's TapedOut log, as a node with a gap would return. */
export function withoutTapeOutLog(
	f: Fixture,
	processor: string,
	id: bigint,
): Fixture {
	let removed = 0;
	const calls = f.calls.map((c) => {
		if (c.method !== "eth_getLogs") return c;
		const logs = c.result as { address: string; topics: string[] }[];
		const kept = logs.filter(
			(l) =>
				!(
					l.address.toLowerCase() === processor &&
					BigInt(l.topics[1] as string) === id
				),
		);
		removed += logs.length - kept.length;
		return { ...c, result: kept };
	});
	if (removed !== 1)
		throw new Error(
			`expected one TapedOut log for ${processor}/${id}, found ${removed}`,
		);
	return { ...f, calls };
}

/**
 * A node built from a fixture's recorded TapedOut reads: it answers any log read, filtered by
 * block range and address list, from the logs the fixture holds, and everything else by replay.
 * Each log read's address list is kept in `asked`. Refuses a read with more than 10 addresses, as
 * publicnode does (docs/decisions/2026-11-21-bnb-nodes.md).
 */
export function logsByAddressClient(f: Fixture): {
	client: PublicClient;
	asked: (string[] | undefined)[];
} {
	type Log = { address: string; blockNumber: string };
	const seen = new Set<string>();
	const logs: Log[] = [];
	for (const c of f.calls) {
		if (c.method !== "eth_getLogs") continue;
		for (const l of c.result as (Log & { logIndex: string })[]) {
			const k = `${l.blockNumber}/${l.logIndex}`;
			if (!seen.has(k)) logs.push(l);
			seen.add(k);
		}
	}
	const replay = replayClient(f);
	const asked: (string[] | undefined)[] = [];
	const client = createPublicClient({
		transport: custom(
			{
				async request({ method, params }) {
					if (method !== "eth_getLogs") {
						return replay.request({ method, params } as never);
					}
					const [q] = params as [
						{ fromBlock: string; toBlock: string; address?: string[] },
					];
					asked.push(q.address);
					if (q.address && q.address.length > 10) {
						throw new Error("more than 10 addresses in one log read");
					}
					const from = BigInt(q.fromBlock);
					const to = BigInt(q.toBlock);
					const wanted = q.address?.map((a) => a.toLowerCase());
					return logs.filter((l) => {
						const b = BigInt(l.blockNumber);
						return (
							b >= from &&
							b <= to &&
							(!wanted || wanted.includes(l.address.toLowerCase()))
						);
					});
				},
				// A missing answer fails at once, as the replay client's does
			},
			{ retryCount: 0 },
		),
	});
	return { client, asked };
}
