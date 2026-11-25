// FabX's miner records, as FabX's mining contract reports them (docs/decisions/2026-11-25-fabx-copy-check.md,
// decisions 5 and 10): status, registrant, task, and the design commitment block and firstUnusedId,
// which count only once confirmed by their event (packages/originality, confirmCommitment).
// FabX's source isn't verified: its getMiner decodes with TapeOut's verified layout, which held
// for all 7,164 of FabX's circuits on 25 Nov 2026. Read only.

import { MULTICALL3, minerKey, podMiningAbi } from "@foreman/chain-bnb";
import type { Address, Hex, PublicClient } from "viem";
import { FABX_MINING, FABX_PROCESSOR } from "./fabx-events.ts";

/** getMiner reads in one Multicall3 bundle, and bundles in flight. */
const PER_BUNDLE = 400;
const BUNDLES_AT_ONCE = 2;

/** The circuits recorded in fixtures/fabx-miners-76847895.json. */
export const FABX_MINER_FIXTURE_IDS = [24n, 1020n, 1648n, 1961n, 66n, 25n] as const;

/** TapeOut's status codes (verified PodMining: ST_ACTIVE 1, ST_REVOKED 2, ST_COOLING 3). */
export type FabxMinerStatus = 1 | 2 | 3;

export interface FabxMinerRecord {
	processor: Address;
	id: bigint;
	key: Hex;
	status: FabxMinerStatus;
	registrant: Address;
	taskId: number;
	/** 0 when no commitment; unconfirmed until its event is found. */
	commitBlock: bigint;
	firstUnusedId: bigint;
}

export type FabxMinersRead =
	| {
			complete: true;
			block: bigint;
			/** Circuits FabX knows as miners (status above 0). */
			miners: FabxMinerRecord[];
			/** Circuits FabX has no miner for (status 0). */
			notMiners: number;
	  }
	| { complete: false; detail: string };

export async function readFabxMiners(
	client: PublicClient,
	query: { ids: readonly bigint[]; blockNumber: bigint },
): Promise<FabxMinersRead> {
	const miners: FabxMinerRecord[] = [];
	let notMiners = 0;
	const starts: number[] = [];
	for (let s = 0; s < query.ids.length; s += PER_BUNDLE) starts.push(s);
	try {
		for (let g = 0; g < starts.length; g += BUNDLES_AT_ONCE) {
			const bundles = await Promise.all(
				starts.slice(g, g + BUNDLES_AT_ONCE).map(async (s) => {
					const ids = query.ids.slice(s, s + PER_BUNDLE);
					const results = await client.multicall({
						contracts: ids.map((id) => ({
							address: FABX_MINING,
							abi: podMiningAbi,
							functionName: "getMiner",
							args: [minerKey({ processor: FABX_PROCESSOR, id })],
						})),
						multicallAddress: MULTICALL3,
						allowFailure: true,
						batchSize: 0,
						blockNumber: query.blockNumber,
					});
					return results.map((r, k) => ({ id: ids[k]!, r }));
				}),
			);
			for (const { id, r } of bundles.flat()) {
				if (r.status !== "success") return { complete: false, detail: `getMiner for FabX #${id} failed` };
				const m = r.result as unknown as {
					status: number;
					registrant: Address;
					taskId: number;
					commitBlock: bigint;
					firstUnusedId: bigint;
				};
				if (m.status === 0) {
					notMiners++;
					continue;
				}
				if (m.status > 3) return { complete: false, detail: `FabX #${id} has unknown status ${m.status}` };
				miners.push({
					processor: FABX_PROCESSOR,
					id,
					key: minerKey({ processor: FABX_PROCESSOR, id }),
					status: m.status as FabxMinerStatus,
					registrant: m.registrant.toLowerCase() as Address,
					taskId: Number(m.taskId),
					commitBlock: BigInt(m.commitBlock),
					firstUnusedId: BigInt(m.firstUnusedId),
				});
			}
		}
	} catch (error) {
		// viem's full message names the node's URL, which can carry a key: keep its short message
		const short = (error as { shortMessage?: string }).shortMessage ?? "read failed";
		return { complete: false, detail: `FabX miners at block ${query.blockNumber}: ${short}` };
	}
	return { complete: true, block: query.blockNumber, miners, notMiners };
}
