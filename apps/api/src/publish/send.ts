// Sending a plan to ForemanResults (docs/decisions/2026-11-21-publish-job.md, decisions 2 and 5).
// First every planned circuit's stored hash on chain is checked against the published-results
// table, and any disagreement stops the run before anything is sent. Then one batch at a time:
// send, wait for the receipt, record the batch only once it confirmed. The first failure stops the
// run. Entries the table already holds with the same hash are skipped, so a stopped run resumes
// with the same plan. Each transaction is signed before it is sent, so a batch that was sent but not
// confirmed always has a hash; it may still land, and recoverBatch records it from its receipt. The
// key never appears here: the wallet arrives already holding its account.

import type { Hex32 } from "@foreman/contract";
import {
	type PublishedRow,
	type ResultsContract,
	readPublished,
	recordPublished,
} from "@foreman/index";
import type pg from "pg";
import {
	type Address,
	BaseError,
	encodeFunctionData,
	keccak256,
	type PublicClient,
	RpcRequestError,
	type WalletClient,
} from "viem";
import { foremanResultsAbi } from "./abi.ts";
import { batchEntries } from "./batch.ts";
import type { Plan, PlanEntry } from "./plan.ts";

const NEVER_PUBLISHED = `0x${"0".repeat(64)}` as Hex32;
/** resultOf reads sent at once in the on-chain check. */
const CHECK_CHUNK = 50;
/** How long to wait for a batch to confirm (viem's default gave up on a testnet batch that landed). */
const RECEIPT_TIMEOUT_MS = 600_000;

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
	/** alreadyPublished: entries skipped because the table holds them with the same hash. */
	| { status: "done"; sent: SentBatch[]; alreadyPublished: number }
	/** The chain and the table disagree: nothing was sent. */
	| { status: "mismatch"; sent: []; mismatches: Mismatch[] }
	/** Refused before the check: the wrong chain, or a wallet that isn't the publisher. */
	| { status: "refused"; sent: []; detail: string }
	/**
	 * Batches before `failedBatch` were sent and recorded; that one and the rest were not recorded.
	 * `pendingTx`: the failed batch was sent but not confirmed, and may still land (recoverBatch).
	 */
	| {
			status: "failed";
			sent: SentBatch[];
			failedBatch: number;
			detail: string;
			pendingTx?: Hex32;
	  };

export async function sendPlan(input: {
	pool: pg.Pool;
	publicClient: PublicClient;
	/** Holds the publisher's account. */
	wallet: WalletClient;
	contract: ResultsContract;
	plan: Plan;
	/** The most entries in one transaction; batches are also kept under the size limit. */
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
	// Every read before the first batch: a failure here sends nothing and records nothing
	let mismatches: Mismatch[];
	let published: Map<Hex32, PublishedRow>;
	try {
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
		published = await readPublished(pool, contract);
		mismatches = await checkOnChain(
			publicClient,
			contract,
			plan.entries,
			published,
		);
	} catch (error) {
		return refused(
			`couldn't read X Layer before sending: ${shortError(error)}; nothing was sent`,
		);
	}
	if (mismatches.length > 0) {
		return { status: "mismatch", sent: [], mismatches };
	}

	// The check has just confirmed these hashes on chain: sending them again would only cost gas
	const toSend = plan.entries.filter(
		(e) => published.get(e.key)?.resultHash !== e.resultHash,
	);
	const alreadyPublished = plan.entries.length - toSend.length;
	const batches = batchEntries(toSend, { maxEntries: input.batchSize });
	const sent: SentBatch[] = [];
	for (const [i, batch] of batches.entries()) {
		let hash: Hex32 | undefined;
		try {
			// Signed first, so the hash is known before anything reaches the node: a node that takes the
			// transaction but times out answering still leaves a hash to recover (batch 125, 21 Nov 2026)
			const request = await wallet.prepareTransactionRequest({
				account,
				chain: wallet.chain,
				to: contract.address,
				data: encodeFunctionData({
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
				}),
			});
			// viem types the prepared request against a narrower account than WalletClient's own
			const signed = await wallet.signTransaction({
				...request,
				account,
				chain: wallet.chain,
			} as Parameters<typeof wallet.signTransaction>[0]);
			hash = keccak256(signed) as Hex32;
			let accepted: Hex32;
			try {
				accepted = (await wallet.sendRawTransaction({
					serializedTransaction: signed,
				})) as Hex32;
			} catch (error) {
				// The node answered with an error, so it kept nothing; a timeout or a dropped
				// connection may still have delivered it
				if (refusedByNode(error)) hash = undefined;
				throw error;
			}
			if (accepted.toLowerCase() !== hash.toLowerCase()) {
				throw new Error(
					`the node returned ${accepted} for transaction ${hash}`,
				);
			}
			const receipt = await publicClient.waitForTransactionReceipt({
				hash,
				timeout: RECEIPT_TIMEOUT_MS,
			});
			if (receipt.status !== "success") {
				return failed(sent, i, `transaction ${hash} reverted`);
			}
			const done: SentBatch = {
				tx: hash,
				block: receipt.blockNumber,
				entries: batch.length,
			};
			await recordPublished(pool, contract, batch, done);
			sent.push(done);
			await input.onBatch?.(done, i, batches.length);
		} catch (error) {
			return hash
				? { ...failed(sent, i, shortError(error)), pendingTx: hash }
				: failed(sent, i, shortError(error));
		}
	}
	return { status: "done", sent, alreadyPublished };
}

/** The node itself answered the request with an error (not a timeout or a lost connection). */
function refusedByNode(error: unknown): boolean {
	return (
		error instanceof BaseError &&
		error.walk((e) => e instanceof RpcRequestError) !== null
	);
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

/**
 * viem's short message plus the node's own reason. Never its full message, which can name the RPC
 * URL, and an RPC URL can carry a key.
 */
function shortError(error: unknown): string {
	const e = error as { shortMessage?: string; details?: string };
	const short = e.shortMessage ?? "request failed";
	return e.details ? `${short} (${e.details})` : short;
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
): Extract<SendReport, { status: "failed" }> => ({
	status: "failed",
	sent,
	failedBatch,
	detail,
});
