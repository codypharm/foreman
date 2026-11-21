// Sending a plan to ForemanResults (docs/decisions/2026-11-21-publish-job.md, decisions 2 and 5).
// First every planned circuit's stored hash on chain is checked against the published-results
// table, and any disagreement stops the run before anything is sent. Then one batch at a time:
// send, wait for the receipt, record the batch only once it confirmed. The first failure stops the
// run. The key never appears here: the wallet arrives already holding its account.

import type { Hex32 } from "@foreman/contract";
import {
	type PublishedRow,
	type ResultsContract,
	readPublished,
	recordPublished,
} from "@foreman/index";
import type pg from "pg";
import type { Address, PublicClient, WalletClient } from "viem";
import { foremanResultsAbi } from "./abi.ts";
import type { Plan, PlanEntry } from "./plan.ts";

const NEVER_PUBLISHED = `0x${"0".repeat(64)}` as Hex32;
/** resultOf reads sent at once in the on-chain check. */
const CHECK_CHUNK = 200;

export interface SentBatch {
	tx: Hex32;
	block: bigint;
	entries: number;
}

export interface Mismatch {
	processor: Address;
	id: bigint;
	onChain: Hex32;
	/** The table's hash, or the zero hash when the table has no row. */
	recorded: Hex32;
}

export type SendReport =
	| { status: "done"; sent: SentBatch[] }
	/** The chain and the table disagree: nothing was sent. */
	| { status: "mismatch"; sent: []; mismatches: Mismatch[] }
	/** Refused before the check: the wrong chain, or a wallet that isn't the publisher. */
	| { status: "refused"; sent: []; detail: string }
	/** Batches before `failedBatch` were sent and recorded; that one and the rest were not. */
	| {
			status: "failed";
			sent: SentBatch[];
			failedBatch: number;
			detail: string;
	  };

export async function sendPlan(input: {
	pool: pg.Pool;
	publicClient: PublicClient;
	/** Holds the publisher's account. */
	wallet: WalletClient;
	contract: ResultsContract;
	plan: Plan;
	batchSize: number;
	onBatch?: (
		batch: SentBatch,
		index: number,
		of: number,
	) => void | Promise<void>;
}): Promise<SendReport> {
	const { pool, publicClient, wallet, contract, plan } = input;
	const account = wallet.account;
	if (!account) return refused("the wallet has no account");
	const chainId = await publicClient.getChainId();
	if (chainId !== contract.chainId) {
		return refused(
			`the RPC is on chain ${chainId}, the contract on ${contract.chainId}`,
		);
	}
	const publisher = await publicClient.readContract({
		address: contract.address,
		abi: foremanResultsAbi,
		functionName: "publisher",
	});
	if (publisher.toLowerCase() !== account.address.toLowerCase()) {
		return refused(
			`the wallet ${account.address} is not the contract's publisher ${publisher}`,
		);
	}

	const mismatches = await checkOnChain(
		publicClient,
		contract,
		plan.entries,
		await readPublished(pool, contract),
	);
	if (mismatches.length > 0)
		return { status: "mismatch", sent: [], mismatches };

	const batches: PlanEntry[][] = [];
	for (let i = 0; i < plan.entries.length; i += input.batchSize) {
		batches.push(plan.entries.slice(i, i + input.batchSize));
	}
	const sent: SentBatch[] = [];
	for (const [i, batch] of batches.entries()) {
		try {
			const hash = await wallet.writeContract({
				address: contract.address,
				abi: foremanResultsAbi,
				functionName: "publish",
				args: [
					batch.map((e) => ({
						processor: e.processor,
						circuitId: e.id,
						kind: e.kind,
						canMine: e.canMine,
						indexBlock: e.indexBlock,
						result: e.result,
					})),
				],
				account,
				chain: wallet.chain,
			});
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			if (receipt.status !== "success") {
				return failed(sent, i, `transaction ${hash} reverted`);
			}
			const done: SentBatch = {
				tx: hash as Hex32,
				block: receipt.blockNumber,
				entries: batch.length,
			};
			await recordPublished(pool, contract, batch, done);
			sent.push(done);
			await input.onBatch?.(done, i, batches.length);
		} catch (error) {
			// viem's full message can name the RPC URL, which can carry a key: keep its short message
			const short =
				(error as { shortMessage?: string }).shortMessage ?? "send failed";
			return failed(sent, i, short);
		}
	}
	return { status: "done", sent };
}

/** Every planned circuit whose hash on chain differs from the table's. */
export async function checkOnChain(
	publicClient: PublicClient,
	contract: ResultsContract,
	entries: PlanEntry[],
	published: Map<Hex32, PublishedRow>,
): Promise<Mismatch[]> {
	const mismatches: Mismatch[] = [];
	for (let i = 0; i < entries.length; i += CHECK_CHUNK) {
		const chunk = entries.slice(i, i + CHECK_CHUNK);
		const stored = await Promise.all(
			chunk.map((e) =>
				publicClient.readContract({
					address: contract.address,
					abi: foremanResultsAbi,
					functionName: "resultOf",
					args: [e.processor, e.id],
				}),
			),
		);
		chunk.forEach((e, j) => {
			const onChain = (stored[j]?.resultHash ?? NEVER_PUBLISHED) as Hex32;
			const recorded = published.get(e.key)?.resultHash ?? NEVER_PUBLISHED;
			if (onChain.toLowerCase() !== recorded.toLowerCase()) {
				mismatches.push({
					processor: e.processor,
					id: e.id,
					onChain,
					recorded,
				});
			}
		});
	}
	return mismatches;
}

const refused = (detail: string): SendReport => ({
	status: "refused",
	sent: [],
	detail,
});

const failed = (
	sent: SentBatch[],
	failedBatch: number,
	detail: string,
): SendReport => ({ status: "failed", sent, failedBatch, detail });
