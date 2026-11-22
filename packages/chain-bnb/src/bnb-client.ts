// The one BNB Chain client the jobs and the API use (docs/decisions/2026-11-21-bnb-nodes.md).
// A read at a block within RECENT_BLOCKS of the head, or at a tag such as latest or finalized, goes
// to the recent node (publicnode), free and without a key. An older read goes to the archive node
// (Alchemy), whose free tier is too small for the jobs but has all history. Logs are split the same
// way: recent ones in 200-block chunks, older ones in 10-block chunks (Alchemy's free-tier limit),
// joined in block order. A read with no block, such as a receipt by hash, goes to the archive node.

import {
	type Chain,
	createPublicClient,
	custom,
	type EIP1193RequestFn,
	http,
	numberToHex,
	type PublicClient,
	type Transport,
} from "viem";
import { bsc } from "viem/chains";
import { MULTICALL3 } from "./abi.ts";

/**
 * Reads this close to the head go to the recent node. On 21 Nov 2026 publicnode served state up to
 * 10,000 blocks back (refusing past 20,000 with an error) and logs in full up to 10,000.
 */
export const RECENT_BLOCKS = 5_000n;
const RECENT_LOG_CHUNK = 200n;
/** Alchemy's free tier: 10 blocks per log read. NodeReal reads 50,000 (BNB_ARCHIVE_LOG_BLOCKS). */
export const ARCHIVE_LOG_BLOCKS = 10n;
/** Archive log chunks in flight at once, for a backfill or a follow that fell behind. */
const ARCHIVE_PARALLEL = 10;
/** The head is read again when this old: 30 s moves the 5,000-block line by about 60 blocks. */
const HEAD_MAX_AGE_MS = 30_000;

/**
 * BNB Smart Chain with Multicall3 pinned to its confirmed address (CLAUDE.md "On-chain facts"), so
 * bundled reads never use an address from anywhere else.
 */
export const BNB_CHAIN: Chain = {
	...bsc,
	contracts: {
		...bsc.contracts,
		multicall3: { address: MULTICALL3, blockCreated: 15_921_452 },
	},
};

/**
 * Bundling for a client whose reads come many at once (the results job): reads at one block made
 * within 16 ms go in one Multicall3 call, up to 4 kB of call data, about 100 reads
 * (docs/decisions/2026-11-22-results-reads-multicall.md).
 */
export const MULTICALL_BATCH = { batchSize: 4_096, wait: 16 } as const;

/** publicnode: state about 10,000 blocks back, logs in 200-block chunks, no key. */
export const PUBLIC_RECENT_RPC = "https://bsc-rpc.publicnode.com";

/** Where each method carries its block; absent means "latest". */
const BLOCK_PARAM: Record<string, number> = {
	eth_call: 1,
	eth_getBalance: 1,
	eth_getCode: 1,
	eth_getTransactionCount: 1,
	eth_getStorageAt: 2,
	eth_getBlockByNumber: 0,
};
/** Methods about the head itself: always the recent node. */
const HEAD_METHODS = new Set([
	"eth_blockNumber",
	"eth_chainId",
	"eth_gasPrice",
]);

interface LogFilter {
	fromBlock: string;
	toBlock: string;
	[key: string]: unknown;
}

export function bnbTransport(nodes: {
	recent: Transport;
	archive: Transport;
	/** Blocks per log read on the archive node; ARCHIVE_LOG_BLOCKS when not given. */
	archiveLogBlocks?: bigint;
}): Transport {
	const archiveChunk = nodes.archiveLogBlocks ?? ARCHIVE_LOG_BLOCKS;
	let archive: EIP1193RequestFn | undefined;
	let recent: EIP1193RequestFn | undefined;
	let head: { block: bigint; at: number } | undefined;
	let headRead: Promise<bigint> | undefined;
	return (config) => {
		const chain: Chain = config.chain ?? bsc;
		archive ??= nodes.archive({ chain, retryCount: 0 }).request;
		recent ??= nodes.recent({ chain, retryCount: 0 }).request;
		const toArchive = archive;
		const toRecent = recent;

		/**
		 * The first block the recent node serves: RECENT_BLOCKS behind its head. One head read at a
		 * time, shared by every read waiting on it: a head read each set off a stampede that
		 * publicnode throttled (21 Nov 2026).
		 */
		const recentFrom = async (): Promise<bigint> => {
			if (!head || Date.now() - head.at > HEAD_MAX_AGE_MS) {
				headRead ??= (async () => {
					try {
						const block = BigInt(
							(await toRecent({
								method: "eth_blockNumber",
							} as never)) as string,
						);
						head = { block, at: Date.now() };
						return block;
					} finally {
						headRead = undefined;
					}
				})();
				await headRead;
			}
			return (head?.block ?? 0n) - RECENT_BLOCKS;
		};

		const read = (
			node: EIP1193RequestFn,
			filter: LogFilter,
			a: bigint,
			b: bigint,
		): Promise<unknown[]> =>
			node({
				method: "eth_getLogs",
				params: [
					{ ...filter, fromBlock: numberToHex(a), toBlock: numberToHex(b) },
				],
			} as never) as Promise<unknown[]>;

		const getLogs = async ([filter]: [LogFilter]): Promise<unknown[]> => {
			if (
				typeof filter?.fromBlock !== "string" ||
				typeof filter.toBlock !== "string" ||
				!filter.fromBlock.startsWith("0x") ||
				!filter.toBlock.startsWith("0x")
			) {
				throw new Error(
					"eth_getLogs needs numbered fromBlock and toBlock on the BNB client",
				);
			}
			const from = BigInt(filter.fromBlock);
			const to = BigInt(filter.toBlock);
			const line = await recentFrom();
			const older =
				from < line
					? chunks(from, to < line ? to : line - 1n, archiveChunk)
					: [];
			const newer =
				to >= line
					? chunks(from > line ? from : line, to, RECENT_LOG_CHUNK)
					: [];
			const out: unknown[] = [];
			for (let i = 0; i < older.length; i += ARCHIVE_PARALLEL) {
				const group = older.slice(i, i + ARCHIVE_PARALLEL);
				const results = await Promise.all(
					group.map(([a, b]) => read(toArchive, filter, a, b)),
				);
				for (const r of results) out.push(...r);
			}
			for (const [a, b] of newer) {
				out.push(...(await read(toRecent, filter, a, b)));
			}
			return out;
		};

		return custom(
			{
				async request({ method, params }) {
					if (method === "eth_getLogs") return getLogs(params as [LogFilter]);
					if (HEAD_METHODS.has(method)) {
						return toRecent({ method, params } as never);
					}
					const at = BLOCK_PARAM[method];
					if (at === undefined) return toArchive({ method, params } as never);
					const block = (params as unknown[] | undefined)?.[at];
					const old =
						typeof block === "string" &&
						block.startsWith("0x") &&
						BigInt(block) < (await recentFrom());
					return (old ? toArchive : toRecent)({ method, params } as never);
				},
			},
			// Each node's own transport retries; retrying here too would multiply them
			{ retryCount: 0 },
		)(config);
	};
}

/** The BNB client from two URLs: the archive node, and the recent node (publicnode by default). */
export function bnbClient(urls: {
	archive: string;
	recent?: string | undefined;
	/** Batch reads, as the market follow's per-listing reads need. */
	batch?: boolean;
	/** Blocks per log read on the archive node: BNB_ARCHIVE_LOG_BLOCKS, 10 when not set. */
	archiveLogBlocks?: string | undefined;
	/** Bundle reads made together at one block into Multicall3 calls (MULTICALL_BATCH). */
	multicall?: boolean;
}): PublicClient {
	const archiveLogBlocks =
		urls.archiveLogBlocks === undefined || urls.archiveLogBlocks === ""
			? undefined
			: BigInt(urls.archiveLogBlocks);
	if (archiveLogBlocks !== undefined && archiveLogBlocks < 1n) {
		throw new Error("BNB_ARCHIVE_LOG_BLOCKS must be a whole number above 0");
	}
	return createPublicClient({
		chain: BNB_CHAIN,
		...(urls.multicall ? { batch: { multicall: MULTICALL_BATCH } } : {}),
		transport: bnbTransport({
			recent: http(urls.recent ?? PUBLIC_RECENT_RPC, {
				retryCount: 5,
				timeout: 30_000,
				batch: urls.batch ? { batchSize: 50 } : false,
			}),
			// Small batches and patient retries: Alchemy's free tier refuses bursts with HTTP 429
			archive: http(urls.archive, {
				retryCount: 8,
				retryDelay: 500,
				timeout: 30_000,
				batch: urls.batch ? { batchSize: 5 } : false,
			}),
			...(archiveLogBlocks === undefined ? {} : { archiveLogBlocks }),
		}),
	});
}

function chunks(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
	const out: [bigint, bigint][] = [];
	for (let a = from; a <= to; a += size) {
		out.push([a, a + size - 1n < to ? a + size - 1n : to]);
	}
	return out;
}
