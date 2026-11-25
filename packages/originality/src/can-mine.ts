// "Can mine" and the design bonus, read from the mining contract
// (docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md; docs/data-contract.md, the
// can-mine and design-bonus facts). Every result carries exactly one can-mine fact; a miner's
// design bonus answer comes first. Never a promise that a circuit passes a task. Read only.

import { POD_MINING, podMiningAbi } from "@foreman/chain-bnb";
import {
	type CantMineReason,
	type Originality,
	type OriginalityFact,
	parseAddress,
} from "@foreman/contract";
import { type PublicClient, zeroAddress } from "viem";
import type { CircuitId } from "./check-wrapper.ts";
import type { MinerRevoke } from "./scan-miner-revokes.ts";
import { minerKey } from "./scan-miner-starts.ts";

/** Blocks after a stop before `start` accepts the miner again (verified PodMining source). */
export const STOP_COOLDOWN = 1_200n;

const multiplierAbi = [
	{
		name: "processorMultiplier",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "processor", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

/** The contract's status codes: ST_NONE, ST_ACTIVE, ST_REVOKED, ST_COOLING. */
const NONE = 0;
const ACTIVE = 1;
const REVOKED = 2;
const COOLING = 3;

export type CanMineRead =
	/**
	 * The design-bonus fact first (miners only), then exactly one can-mine fact; and TapeOut's
	 * mining contract when the circuit has a miner record, null when it has none.
	 */
	| { read: true; facts: OriginalityFact[]; mining: Originality["mining"] }
	/** Shown as "Can't check", never as a can-mine answer. */
	| { read: false; detail: string };

export async function readCanMine(
	client: PublicClient,
	input: {
		circuit: CircuitId;
		/** Whether its netlist has a REF record: `start` refuses it. */
		usesRef: boolean;
		/** Its Revoked event from the index, or null when the index has none. */
		revoke: Omit<MinerRevoke, "key"> | null;
	},
	at: { blockNumber: bigint },
): Promise<CanMineRead> {
	const { circuit } = input;
	const key = minerKey(circuit);
	let m: Awaited<ReturnType<typeof readMiner>>;
	let multiplier: bigint;
	try {
		[m, multiplier] = await Promise.all([
			readMiner(client, key, at),
			client.readContract({
				address: POD_MINING,
				abi: multiplierAbi,
				functionName: "processorMultiplier",
				args: [circuit.processor],
				blockNumber: at.blockNumber,
			}),
		]);
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ?? "read failed";
		return {
			read: false,
			detail: `${circuit.processor}/${circuit.id} at block ${at.blockNumber}: ${short}`,
		};
	}

	const facts: OriginalityFact[] = [];
	const mining: Originality["mining"] =
		m.status === NONE
			? null
			: { chainId: 56, contract: parseAddress(POD_MINING, "POD_MINING") };
	if (m.status !== NONE) {
		facts.push({ fact: "design-bonus", holds: m.optimal, bonus: m.bonus });
	}
	if (m.status === ACTIVE) {
		facts.push({ fact: "can-mine", state: "mining" });
		return { read: true, facts, mining };
	}
	if (m.status === COOLING) {
		facts.push({
			fact: "can-mine",
			state: "stopped",
			stoppedAt: m.stopBlock,
			canStartFrom: m.stopBlock + STOP_COOLDOWN,
		});
		return { read: true, facts, mining };
	}

	const reasons: CantMineReason[] = [];
	if (multiplier === 0n) reasons.push({ reason: "processor-not-eligible" });
	if (input.usesRef) reasons.push({ reason: "uses-ref" });
	if (m.status === REVOKED) {
		if (!input.revoke) {
			return {
				read: false,
				detail: `${circuit.processor}/${circuit.id} is revoked, but the index has no Revoked event for miner ${key}`,
			};
		}
		reasons.push({
			reason: "failed-test-vector",
			taskId: m.taskId,
			vectorIndex: input.revoke.vectorIndex,
			block: input.revoke.revokedAt.block,
		});
	} else if (m.status !== NONE) {
		return {
			read: false,
			detail: `${circuit.processor}/${circuit.id} has status ${m.status}, which the contract does not define`,
		};
	}
	facts.push(
		reasons.length > 0
			? { fact: "can-mine", state: "cant-mine", reasons }
			: { fact: "can-mine", state: "not-started" },
	);
	return { read: true, facts, mining };
}

async function readMiner(
	client: PublicClient,
	key: ReturnType<typeof minerKey>,
	at: { blockNumber: bigint },
) {
	const m = await client.readContract({
		address: POD_MINING,
		abi: podMiningAbi,
		functionName: "getMiner",
		args: [key],
		blockNumber: at.blockNumber,
	});
	return m.circuits === zeroAddress ? { ...m, status: NONE } : m;
}
