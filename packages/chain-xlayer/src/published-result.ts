// Reading a published result back from ForemanResults on X Layer (CLAUDE.md, "Published results are
// reproducible"; docs/decisions/2026-11-21-results-contract.md). Two reads at one block: the publish
// transaction's Published log, whose bytes are the data contract's Originality JSON, and the
// contract's stored short verdict for the circuit. The logged bytes are hashed here and compared with
// what the contract stores; nothing is taken on Foreman's word. Read only.

import {
	type Address,
	type Hex32,
	indexBlock,
	type Originality,
	parseOriginality,
} from "@foreman/contract";
import {
	hexToString,
	keccak256,
	type PublicClient,
	parseEventLogs,
	TransactionReceiptNotFoundError,
} from "viem";
import {
	foremanResultsAbi,
	type ResultsChain,
	shortVerdict,
} from "./results-contract.ts";

export interface PublishedReadBack {
	/** The X Layer block the contract's storage was read at (testnet included, so not the contract's ChainRead). */
	readAt: { chainId: ResultsChain; block: bigint; time: bigint };
	publishedAt: { block: bigint; tx: Hex32 };
	/** The result in the transaction's Published log, decoded by the data contract's parser. */
	logged: Originality;
	/** keccak256 of the logged bytes, computed here. */
	loggedHash: Hex32;
	/** What the contract stores for the circuit now; null when it stores nothing. */
	stored: {
		kind: number;
		canMine: number;
		indexBlock: bigint;
		resultHash: Hex32;
	} | null;
	/** The contract stores this publish: the same hash. */
	current: boolean;
	/** The log's short verdict and index block are the decoded result's. */
	shortVerdictAgrees: boolean;
}

export type ReadBackFailure =
	| "no-transaction"
	| "failed-transaction"
	| "no-log"
	/** Published before 25 Nov 2026, in the shape before `mining` and `index.upTo`; published again in today's (2026-11-25-republish-in-new-shape.md). */
	| "earlier-format"
	| "unreadable-result";

/** A read-back that found something other than a published result. Its message is plain words. */
export class ReadBackError extends Error {
	readonly reason: ReadBackFailure;
	constructor(reason: ReadBackFailure, message: string) {
		super(message);
		this.reason = reason;
	}
}

export async function readPublishedResult(
	client: PublicClient,
	q: {
		chainId: ResultsChain;
		contract: Address;
		processor: Address;
		circuitId: bigint;
		tx: Hex32;
		/** Defaults to X Layer's latest block. */
		blockNumber?: bigint;
	},
): Promise<PublishedReadBack> {
	const blockNumber = q.blockNumber ?? (await client.getBlockNumber());
	const [block, receipt, stored] = await Promise.all([
		client.getBlock({ blockNumber }),
		client.getTransactionReceipt({ hash: q.tx }).catch((error: unknown) => {
			if (error instanceof TransactionReceiptNotFoundError) {
				throw new ReadBackError(
					"no-transaction",
					`X Layer has no transaction ${q.tx}.`,
				);
			}
			throw error;
		}),
		client.readContract({
			address: q.contract,
			abi: foremanResultsAbi,
			functionName: "resultOf",
			args: [q.processor, q.circuitId],
			blockNumber,
		}),
	]);
	if (receipt.status !== "success") {
		throw new ReadBackError(
			"failed-transaction",
			"That transaction failed on X Layer, so it published nothing.",
		);
	}

	const log = parseEventLogs({
		abi: foremanResultsAbi,
		eventName: "Published",
		logs: receipt.logs,
	}).find(
		(l) =>
			l.address.toLowerCase() === q.contract.toLowerCase() &&
			l.args.processor.toLowerCase() === q.processor.toLowerCase() &&
			l.args.circuitId === q.circuitId,
	);
	if (!log) {
		throw new ReadBackError(
			"no-log",
			`That transaction published no result for circuit #${q.circuitId}.`,
		);
	}

	const loggedHash = keccak256(log.args.result) as Hex32;
	let logged: Originality;
	let json: unknown;
	try {
		json = JSON.parse(hexToString(log.args.result));
		logged = parseOriginality(json, "logged");
	} catch {
		if (isEarlierFormat(json)) {
			throw new ReadBackError(
				"earlier-format",
				"This circuit’s last result was published in an earlier format, before 25 November 2026. Foreman publishes it again in the current one.",
			);
		}
		throw new ReadBackError(
			"unreadable-result",
			"The logged result isn’t one the data contract can read.",
		);
	}
	if (
		logged.circuit.processor !== q.processor.toLowerCase() ||
		logged.circuit.tokenId !== q.circuitId
	) {
		throw new ReadBackError(
			"unreadable-result",
			"The logged result names a different circuit.",
		);
	}

	const short = shortVerdict(logged);
	return {
		readAt: { chainId: q.chainId, block: block.number, time: block.timestamp },
		publishedAt: { block: receipt.blockNumber, tx: q.tx },
		logged,
		loggedHash,
		stored:
			stored.kind === 0
				? null
				: {
						kind: stored.kind,
						canMine: stored.canMine,
						indexBlock: stored.indexBlock,
						resultHash: stored.resultHash as Hex32,
					},
		current: stored.kind !== 0 && stored.resultHash === loggedHash,
		shortVerdictAgrees:
			log.args.kind === short.kind &&
			log.args.canMine === short.canMine &&
			log.args.indexBlock === indexBlock(logged.index, 56),
	};
}

/** The shape before 25 Nov 2026: one-chain `index.upToBlock` and no `mining`. */
function isEarlierFormat(json: unknown): boolean {
	if (json === null || typeof json !== "object") return false;
	const o = json as { mining?: unknown; index?: { upToBlock?: unknown } };
	return !("mining" in o) && o.index?.upToBlock !== undefined;
}
