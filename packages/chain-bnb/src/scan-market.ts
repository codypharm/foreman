// One pass over TapeOut's circuit market for the index (docs/decisions/2026-11-20-market-index.md):
// its events in a block range, every listing they touched read again at the end block, recent
// sales' miners at the block before each sale, and every open listing's miner and whether it can
// be bought, at the end block. Complete, or a stated failure: never part of it. Read only.

import type { Address, NetworkState } from "@foreman/contract";
import {
	BaseError,
	type ContractFunctionReturnType,
	ContractFunctionRevertedError,
	decodeFunctionResult,
	encodeFunctionData,
	type PublicClient,
	zeroAddress,
} from "viem";
import {
	CIRCUIT_MARKET,
	CIRCUIT_MARKET_IMPLEMENTATION,
	CIRCUIT_MARKET_UPGRADES,
	circuitMarketAbi,
	ERC1967_IMPLEMENTATION_SLOT,
	MULTICALL3,
	multicall3Abi,
	POD_MINING,
	podMiningAbi,
} from "./abi.ts";
import {
	type MarketEvent,
	type MarketListing,
	readListing,
	readMarketEvents,
} from "./market.ts";
import { minerKey } from "./miner-key.ts";
import { readNetworkState } from "./read-network.ts";

/** The getMiner fields the comparables rule needs. Status 1 is mining; task 0 is the unverified pool. */
export interface MarketMinerState {
	status: number;
	taskId: number;
	verifWeight: bigint;
	unverWeight: bigint;
	/** bstar × multiplier while mining, 0 otherwise: the weight it keeps if it loses the design bonus. */
	weightWithoutBonus: bigint;
}

export type MarketSaleEvent = Extract<MarketEvent, { event: "sold" }>;

export interface ScannedSale {
	sale: MarketSaleEvent;
	/** At the block before the sale; null when the sale is older than the state window (not read). */
	miner: MarketMinerState | null;
}

export interface ScannedListing {
	listingId: bigint;
	/** At the end block: null when sold or withdrawn (the market zeroes it). */
	listing: MarketListing | null;
}

export interface OpenListingState {
	listingId: bigint;
	/** The seller holds the miner and the market may move it. */
	buyable: boolean;
	miner: MarketMinerState;
}

export type MarketScan =
	| {
			complete: true;
			fromBlock: bigint;
			upToBlock: bigint;
			upToTime: bigint;
			/** nextListingId at the end block: the listing ids issued so far. */
			listingsIssued: bigint;
			sales: ScannedSale[];
			/** Every listing an event in the range touched. */
			listings: ScannedListing[];
			/** Each listing created in the range, with its Listed event's block and time. */
			listed: { listingId: bigint; block: bigint; time: bigint }[];
			/** Every listing open at the end block, touched or not. */
			states: OpenListingState[];
			/** The network at the end block, to value each open listing's weight without a live read. */
			network: NetworkState;
	  }
	| { complete: false; detail: string };

const nftAbi = [
	{
		name: "ownerOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "tokenId", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
	},
	{
		name: "getApproved",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "tokenId", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
	},
	{
		name: "isApprovedForAll",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "operator", type: "address" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

/** 100 listings, 400 reads, about 40 kB of call data: far inside a node's eth_call gas cap. */
const LISTINGS_PER_BUNDLE = 100;
const BUNDLES_AT_ONCE = 4;

/** Catch-up rounds at most: each reads the blocks the last one took, so they shrink fast. */
const CATCH_UP_ROUNDS = 5;
/** A round this short took seconds: the head it reached is near enough to read state at. */
const CAUGHT_UP_BLOCKS = 1_000n;

export async function scanMarket(
	client: PublicClient,
	input: {
		fromBlock: bigint;
		toBlock: bigint;
		/** Listing ids the index already holds: with the range's Listed events, they must equal nextListingId. */
		listingsIndexed: bigint;
		/** Listings the index holds as open: their state is read again even if no event touched them. */
		open: MarketListing[];
		/** Sales this many seconds before the end block's time, or later, get their miner's state. */
		stateWindowSeconds: bigint;
		/** Listings read at once; with a batching transport, one request each. */
		concurrency?: number;
		/**
		 * The head to catch up to. When given, the scan reads events on past `toBlock` to it, in
		 * rounds, before any state read, so every listing is read near the head. A catch-up through
		 * the archive node can take hours, and a state read that old is refused by the recent node
		 * and too large a burst for the archive node (docs/decisions/2026-11-22-market-follow-block.md).
		 */
		catchUpTo?: () => Promise<bigint>;
	},
): Promise<MarketScan> {
	const { fromBlock } = input;
	let toBlock = input.toBlock;
	const concurrency = input.concurrency ?? 50;
	let stage = `market events, blocks ${fromBlock} to ${toBlock}`;
	try {
		const events = await readMarketEvents(client, { fromBlock, toBlock });
		for (let round = 0; input.catchUpTo && round < CATCH_UP_ROUNDS; round++) {
			const head = await input.catchUpTo();
			if (head <= toBlock) break;
			stage = `market events, blocks ${toBlock + 1n} to ${head}`;
			events.push(
				...(await readMarketEvents(client, {
					fromBlock: toBlock + 1n,
					toBlock: head,
				})),
			);
			const gap = head - toBlock;
			toBlock = head;
			if (gap <= CAUGHT_UP_BLOCKS) break;
		}
		const at = { blockNumber: toBlock };

		// The market's code: only the known upgrades, and the confirmed code at the end block
		// (docs/decisions/2026-11-20-market-admin-events.md)
		for (const e of events) {
			if (e.event !== "upgraded") continue;
			const known = CIRCUIT_MARKET_UPGRADES.some(
				(u) =>
					u.block === e.at.block &&
					u.implementation === String(e.implementation),
			);
			if (!known) {
				return {
					complete: false,
					detail: `the market was upgraded at block ${e.at.block} to ${e.implementation}, which nobody has checked: the market follow stops until it is accepted`,
				};
			}
		}
		stage = `the market's code at block ${toBlock}`;
		const slot = await client.getStorageAt({
			address: CIRCUIT_MARKET,
			slot: ERC1967_IMPLEMENTATION_SLOT,
			blockNumber: toBlock,
		});
		const implementation = `0x${(slot ?? "0x").slice(-40)}`.toLowerCase();
		if (implementation !== CIRCUIT_MARKET_IMPLEMENTATION) {
			return {
				complete: false,
				detail: `the market's code at block ${toBlock} is ${implementation}, not the confirmed ${CIRCUIT_MARKET_IMPLEMENTATION}: the market follow stops until it is accepted`,
			};
		}

		stage = `nextListingId at block ${toBlock}`;
		const [listingsIssued, end] = await Promise.all([
			client.readContract({
				address: CIRCUIT_MARKET,
				abi: circuitMarketAbi,
				functionName: "nextListingId",
				blockNumber: toBlock,
			}),
			client.getBlock({ blockNumber: toBlock }),
		]);
		const listed = BigInt(events.filter((e) => e.event === "listed").length);
		if (input.listingsIndexed + listed !== listingsIssued) {
			return {
				complete: false,
				detail: `listing count: ${input.listingsIndexed} indexed + ${listed} Listed events in blocks ${fromBlock} to ${toBlock}, but nextListingId is ${listingsIssued} at block ${toBlock}`,
			};
		}

		stage = `touched listings at block ${toBlock}`;
		const touched = [
			...new Set(
				events.flatMap((e) => ("listingId" in e ? [e.listingId] : [])),
			),
		];
		const listings = await inBatches(
			touched,
			concurrency,
			async (listingId) => ({
				listingId,
				listing: await readListing(client, listingId, at),
			}),
		);

		stage = "sold miners at the block before each sale";
		const since = end.timestamp - input.stateWindowSeconds;
		const sold = events.filter((e): e is MarketSaleEvent => e.event === "sold");
		const sales = await inBatches(sold, concurrency, async (sale) => ({
			sale,
			miner:
				sale.at.time >= since
					? await readMinerState(client, sale.processor, sale.tokenId, {
							blockNumber: sale.at.block - 1n,
						})
					: null,
		}));

		stage = `open listings at block ${toBlock}`;
		const open = new Map(input.open.map((l) => [l.listingId, l]));
		for (const { listingId, listing } of listings) {
			if (listing) open.set(listingId, listing);
			else open.delete(listingId);
		}
		const states = await readListingStates(client, [...open.values()], at);

		stage = `the network at block ${toBlock}`;
		const network = await readNetworkState(client, at);

		return {
			complete: true,
			fromBlock,
			upToBlock: toBlock,
			upToTime: end.timestamp,
			listingsIssued,
			sales,
			listings,
			listed: events.flatMap((e) =>
				e.event === "listed"
					? [{ listingId: e.listingId, block: e.at.block, time: e.at.time }]
					: [],
			),
			states,
			network,
		};
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ??
			(error as Error).message ??
			"read failed";
		return { complete: false, detail: `${stage}: ${short}` };
	}
}

async function readMinerState(
	client: PublicClient,
	processor: Address,
	tokenId: bigint,
	at: { blockNumber: bigint },
): Promise<MarketMinerState> {
	const m = await client.readContract({
		address: POD_MINING,
		abi: podMiningAbi,
		functionName: "getMiner",
		args: [minerKey({ processor, id: tokenId })],
		blockNumber: at.blockNumber,
	});
	return minerStateFrom(m);
}

type GetMiner = ContractFunctionReturnType<
	typeof podMiningAbi,
	"view",
	"getMiner"
>;

function minerStateFrom(m: GetMiner): MarketMinerState {
	const status = m.circuits === zeroAddress ? 0 : m.status;
	return {
		status,
		taskId: m.taskId,
		verifWeight: m.verifWeight,
		unverWeight: m.unverWeight,
		// As the miner reader: the contract zeroes a stopped miner's weights, so 0 unless active
		weightWithoutBonus: status === 1 ? m.bstar * BigInt(m.mult) : 0n,
	};
}

/**
 * Every open listing's state at one block, in Multicall3 bundles of LISTINGS_PER_BUNDLE listings
 * (4 reads each), BUNDLES_AT_ONCE at a time (docs/decisions/2026-11-22-market-reads-multicall.md).
 * A listing with any failed read in its bundle is read again on its own, so a revert means what it
 * meant before and a node failure still fails the scan: a read starved of gas inside a bundle is
 * never taken for a revert.
 */
async function readListingStates(
	client: PublicClient,
	listings: MarketListing[],
	at: { blockNumber: bigint },
): Promise<OpenListingState[]> {
	// Listing id order: the same listings make the same bundles, whatever order they came in
	const sorted = [...listings].sort((a, b) =>
		a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0,
	);
	const bundles: MarketListing[][] = [];
	for (let i = 0; i < sorted.length; i += LISTINGS_PER_BUNDLE) {
		bundles.push(sorted.slice(i, i + LISTINGS_PER_BUNDLE));
	}
	const read = await inBatches(bundles, BUNDLES_AT_ONCE, async (bundle) => {
		const calls = bundle.flatMap((l) => [
			{
				target: POD_MINING,
				allowFailure: true,
				callData: encodeFunctionData({
					abi: podMiningAbi,
					functionName: "getMiner",
					args: [minerKey({ processor: l.processor, id: l.tokenId })],
				}),
			},
			...(["ownerOf", "getApproved"] as const).map((functionName) => ({
				target: l.processor,
				allowFailure: true,
				callData: encodeFunctionData({
					abi: nftAbi,
					functionName,
					args: [l.tokenId],
				}),
			})),
			{
				target: l.processor,
				allowFailure: true,
				callData: encodeFunctionData({
					abi: nftAbi,
					functionName: "isApprovedForAll",
					args: [l.seller, CIRCUIT_MARKET],
				}),
			},
		]);
		const results = await client.readContract({
			address: MULTICALL3,
			abi: multicall3Abi,
			functionName: "aggregate3",
			args: [calls],
			blockNumber: at.blockNumber,
		});
		if (results.length !== calls.length) {
			throw new Error(
				`Multicall3 answered ${results.length} of ${calls.length} reads`,
			);
		}
		return Promise.all(
			bundle.map(async (l, i) => {
				const [miner, owner, approved, all] = results.slice(i * 4, i * 4 + 4);
				if (
					!miner?.success ||
					!owner?.success ||
					!approved?.success ||
					!all?.success
				) {
					return readListingState(client, l, at);
				}
				return listingState(l, {
					miner: minerStateFrom(
						decodeFunctionResult({
							abi: podMiningAbi,
							functionName: "getMiner",
							data: miner.returnData,
						}),
					),
					owner: decodeFunctionResult({
						abi: nftAbi,
						functionName: "ownerOf",
						data: owner.returnData,
					}),
					approved: decodeFunctionResult({
						abi: nftAbi,
						functionName: "getApproved",
						data: approved.returnData,
					}),
					all: decodeFunctionResult({
						abi: nftAbi,
						functionName: "isApprovedForAll",
						data: all.returnData,
					}),
				});
			}),
		);
	});
	return read.flat();
}

function listingState(
	l: MarketListing,
	r: { miner: MarketMinerState; owner: string; approved: string; all: boolean },
): OpenListingState {
	const buyable =
		r.owner.toLowerCase() === l.seller &&
		(r.approved.toLowerCase() === CIRCUIT_MARKET || r.all);
	return { listingId: l.listingId, buyable, miner: r.miner };
}

async function readListingState(
	client: PublicClient,
	l: MarketListing,
	at: { blockNumber: bigint },
): Promise<OpenListingState> {
	const nft = (functionName: "ownerOf" | "getApproved", args: [bigint]) =>
		client.readContract({
			address: l.processor,
			abi: nftAbi,
			functionName,
			args,
			blockNumber: at.blockNumber,
		});
	const [miner, owner, approved, all] = await Promise.all([
		readMinerState(client, l.processor, l.tokenId, at),
		// A token that no longer exists reverts: nobody can buy it
		nft("ownerOf", [l.tokenId]).catch(revertedAs(zeroAddress)),
		nft("getApproved", [l.tokenId]).catch(revertedAs(zeroAddress)),
		client.readContract({
			address: l.processor,
			abi: nftAbi,
			functionName: "isApprovedForAll",
			args: [l.seller, CIRCUIT_MARKET],
			blockNumber: at.blockNumber,
		}),
	]);
	return listingState(l, { miner, owner, approved, all });
}

/** A contract revert becomes `value`; any other failure (the node, the network) is rethrown. */
function revertedAs<T>(value: T) {
	return (error: unknown): T => {
		if (
			error instanceof BaseError &&
			error.walk((e) => e instanceof ContractFunctionRevertedError)
		) {
			return value;
		}
		throw error;
	};
}

async function inBatches<T, R>(
	items: T[],
	size: number,
	read: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(...(await Promise.all(items.slice(i, i + size).map(read))));
	}
	return out;
}
