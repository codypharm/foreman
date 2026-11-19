// Reads one miner from the BNB mining contract into the contract's Miner shape.
// Every call is made at the same block, and the result goes through the contract's
// parser before it is returned (docs/decisions/2026-11-19-chain-readers.md).

import {
	type Hex32,
	type Miner,
	parseAddress,
	parseMiner,
	serialiseMiner,
} from "@foreman/contract";
import { type PublicClient, zeroAddress } from "viem";
import { erc721OwnerOfAbi, POD_MINING, podMiningAbi } from "./abi.ts";
import { ChainReadError, UnknownMinerError } from "./errors.ts";

/** The contract's status codes: ST_NONE, ST_ACTIVE, ST_REVOKED, ST_COOLING. */
const STATUSES = ["not-mining", "active", "revoked", "cooling"] as const;

export async function readMiner(
	client: PublicClient,
	key: Hex32,
	at: { blockNumber: bigint },
): Promise<Miner> {
	const { blockNumber } = at;
	const [block, m] = await Promise.all([
		client.getBlock({ blockNumber }),
		client.readContract({
			address: POD_MINING,
			abi: podMiningAbi,
			functionName: "getMiner",
			args: [key],
			blockNumber,
		}),
	]);
	if (m.circuits === zeroAddress) throw new UnknownMinerError(key);

	const processor = parseAddress(m.circuits.toLowerCase(), "getMiner.circuits");
	const owner = await client.readContract({
		address: processor,
		abi: erc721OwnerOfAbi,
		functionName: "ownerOf",
		args: [m.circuitId],
		blockNumber,
	});

	const status = STATUSES[m.status];
	if (status === undefined) {
		throw new ChainReadError(
			`Miner ${key} has status ${m.status}, which the contract does not define`,
		);
	}
	const pool = m.taskId === 0 ? "unverified" : "verified";
	const active = status === "active";
	if (!active && (m.verifWeight !== 0n || m.unverWeight !== 0n)) {
		throw new ChainReadError(
			`Miner ${key} is ${status} but still has weight; the verified source zeroes it`,
		);
	}

	const miner: Miner = {
		key,
		processor,
		tokenId: m.circuitId,
		owner: parseAddress(owner.toLowerCase(), "ownerOf"),
		status,
		pool,
		taskId: pool === "verified" ? m.taskId : null,
		weight: !active ? 0n : pool === "verified" ? m.verifWeight : m.unverWeight,
		weightWithoutBonus: active ? m.bstar * BigInt(m.mult) : 0n,
		holdsBonus: active && m.optimal && m.bonus > 0n,
		miningSince: m.since,
		readAt: { chainId: 56, block: block.number, time: block.timestamp },
	};
	// The contract's checks (pool and task agree, bonus adds weight, ...) run against real data
	return parseMiner(serialiseMiner(miner, "miner"), "miner");
}
