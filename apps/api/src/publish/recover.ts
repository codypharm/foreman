// Recording a batch that landed on chain but was never recorded, for example because the wait for
// its receipt timed out (docs/decisions/2026-11-21-publish-job.md, decision 2: the chain is the
// authority, and the table follows it). Read only on chain; it signs nothing. Every Published event
// in the transaction must match an entry of the plan, with the same key, hash and short verdict, or
// nothing is recorded.

import type { Hex32 } from "@foreman/contract";
import { type ResultsContract, recordPublished } from "@foreman/index";
import type pg from "pg";
import { type Address, type PublicClient, parseEventLogs } from "viem";
import { foremanResultsAbi } from "./abi.ts";
import type { Plan, PlanEntry } from "./plan.ts";

export type RecoverReport =
	| { recovered: true; tx: Hex32; block: bigint; entries: number }
	| { recovered: false; detail: string };

export async function recoverBatch(input: {
	pool: pg.Pool;
	publicClient: PublicClient;
	contract: ResultsContract;
	plan: Plan;
	tx: Hex32;
}): Promise<RecoverReport> {
	const { pool, publicClient, contract, plan, tx } = input;
	const no = (detail: string): RecoverReport => ({
		recovered: false,
		detail: `${tx}: ${detail}; nothing recorded`,
	});

	const chainId = await publicClient.getChainId();
	if (chainId !== contract.chainId) {
		return no(
			`the RPC is on chain ${chainId}, the contract on ${contract.chainId}`,
		);
	}
	const receipt = await publicClient.getTransactionReceipt({ hash: tx });
	if (receipt.status !== "success") return no("the transaction reverted");
	if (receipt.to?.toLowerCase() !== contract.address.toLowerCase()) {
		return no(
			`it was sent to ${receipt.to ?? "no contract"}, not ${contract.address}`,
		);
	}
	const publisher: Address = await publicClient.readContract({
		address: contract.address,
		abi: foremanResultsAbi,
		functionName: "publisher",
		blockNumber: receipt.blockNumber,
	});
	if (receipt.from.toLowerCase() !== publisher.toLowerCase()) {
		return no(`it came from ${receipt.from}, not the publisher ${publisher}`);
	}

	const logs = parseEventLogs({
		abi: foremanResultsAbi,
		eventName: "Published",
		logs: receipt.logs.filter(
			(l) => l.address.toLowerCase() === contract.address.toLowerCase(),
		),
	});
	if (logs.length === 0) return no("it has no Published events");
	const byKey = new Map(plan.entries.map((e) => [e.key.toLowerCase(), e]));
	const entries: PlanEntry[] = [];
	for (const log of logs) {
		const e = byKey.get(log.args.key.toLowerCase());
		const a = log.args;
		if (
			!e ||
			a.resultHash.toLowerCase() !== e.resultHash.toLowerCase() ||
			a.kind !== e.kind ||
			a.canMine !== e.canMine ||
			a.indexBlock !== e.indexBlock
		) {
			return no(
				`its result for ${a.processor}/${a.circuitId} is not the plan's`,
			);
		}
		entries.push(e);
	}
	await recordPublished(pool, contract, entries, {
		tx,
		block: receipt.blockNumber,
	});
	return {
		recovered: true,
		tx,
		block: receipt.blockNumber,
		entries: entries.length,
	};
}
