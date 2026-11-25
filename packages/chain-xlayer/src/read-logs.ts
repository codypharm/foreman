// Event logs from X Layer's public nodes (docs/decisions/2026-11-25-fabx-copy-check.md, "X Layer
// reads"). They serve eth_getLogs 100 blocks per read and about 5 reads at a time each, so a range
// is cut into 100-block pieces and shared between several nodes. A piece that keeps failing ends
// the read: a log read is complete or it is an error, never a silent gap (CLAUDE.md, "Bad input").
// Read only.

import type { Address, Hex } from "viem";

/** X Layer's public nodes serve logs at most 100 blocks per read (CLAUDE.md, "RPC notes"). */
export const XLAYER_LOG_BLOCKS = 100n;
/** Reads in flight per node: each answers about 5 log reads at once, measured 25 Nov 2026. */
export const READS_PER_NODE = 4;
/** Tries per piece before the whole read fails. */
const TRIES = 8;

/** Anything that answers JSON-RPC requests: a viem client or a test double. */
export interface LogNode {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface XLayerLog {
	address: Address;
	topics: Hex[];
	data: Hex;
	blockNumber: bigint;
	transactionIndex: number;
	logIndex: number;
	transactionHash: Hex;
	/** Its block's time (Unix seconds), when the node returns it. */
	blockTimestamp?: bigint;
}

export type LogRead =
	| { complete: true; fromBlock: bigint; toBlock: bigint; logs: XLayerLog[] }
	| { complete: false; detail: string };

export interface LogReadOptions {
	readsPerNode?: number;
	/** Waits between tries; replaced in tests. */
	sleep?: (ms: number) => Promise<void>;
	/** Called once per piece read, in the order pieces finish, to save progress. */
	onPiece?: (piece: { fromBlock: bigint; toBlock: bigint; logs: XLayerLog[] }) => void | Promise<void>;
	/** Pieces already read earlier (by their first block), left out. */
	skip?: (fromBlock: bigint) => boolean;
}

interface RawLog {
	address: string;
	topics: Hex[];
	data: Hex;
	blockNumber: Hex;
	transactionIndex: Hex;
	logIndex: Hex;
	transactionHash: Hex;
	blockTimestamp?: Hex;
}

export async function readLogs(
	nodes: readonly LogNode[],
	query: { addresses: readonly Address[]; fromBlock: bigint; toBlock: bigint },
	options: LogReadOptions = {},
): Promise<LogRead> {
	if (nodes.length === 0) return { complete: false, detail: "no X Layer node to read from" };
	if (query.toBlock < query.fromBlock)
		return { complete: false, detail: `empty range ${query.fromBlock} to ${query.toBlock}` };
	const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const perNode = options.readsPerNode ?? READS_PER_NODE;

	const pieces: { fromBlock: bigint; toBlock: bigint; tries: number }[] = [];
	for (let from = query.fromBlock; from <= query.toBlock; from += XLAYER_LOG_BLOCKS) {
		if (options.skip?.(from)) continue;
		const to = from + XLAYER_LOG_BLOCKS - 1n;
		pieces.push({ fromBlock: from, toBlock: to < query.toBlock ? to : query.toBlock, tries: 0 });
	}

	const logs: XLayerLog[] = [];
	let failed: string | undefined;
	const address = query.addresses.map((a) => a.toLowerCase());

	async function worker(node: LogNode) {
		while (failed === undefined) {
			const piece = pieces.shift();
			if (!piece) return;
			try {
				const answer = await node.request({
					method: "eth_getLogs",
					params: [{ address, fromBlock: hex(piece.fromBlock), toBlock: hex(piece.toBlock) }],
				});
				if (!Array.isArray(answer)) throw shortError("the node's answer isn't a list of logs");
				const read = (answer as RawLog[]).map(parseLog);
				logs.push(...read);
				await options.onPiece?.({ fromBlock: piece.fromBlock, toBlock: piece.toBlock, logs: read });
			} catch (error) {
				piece.tries++;
				// viem's full message names the node's URL, which can carry a key: keep its short message
				const short = (error as { shortMessage?: string }).shortMessage ?? "read failed";
				if (piece.tries >= TRIES) {
					failed = `blocks ${piece.fromBlock} to ${piece.toBlock}: ${short}, after ${TRIES} tries`;
					return;
				}
				pieces.push(piece);
				await sleep(250 * 2 ** Math.min(piece.tries, 5));
			}
		}
	}

	await Promise.all(nodes.flatMap((n) => Array.from({ length: perNode }, () => worker(n))));
	if (failed !== undefined) return { complete: false, detail: failed };
	logs.sort(
		(a, b) =>
			cmp(a.blockNumber, b.blockNumber) || a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex,
	);
	return { complete: true, fromBlock: query.fromBlock, toBlock: query.toBlock, logs };
}

function parseLog(raw: RawLog): XLayerLog {
	return {
		address: raw.address.toLowerCase() as Address,
		topics: raw.topics,
		data: raw.data,
		blockNumber: BigInt(raw.blockNumber),
		transactionIndex: Number(BigInt(raw.transactionIndex)),
		logIndex: Number(BigInt(raw.logIndex)),
		transactionHash: raw.transactionHash,
		...(raw.blockTimestamp ? { blockTimestamp: BigInt(raw.blockTimestamp) } : {}),
	};
}

const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;
const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
const shortError = (shortMessage: string) => Object.assign(new Error(shortMessage), { shortMessage });
