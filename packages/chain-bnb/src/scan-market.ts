// One pass over TapeOut's circuit market for the index (docs/decisions/2026-11-20-market-index.md):
// its events in a block range, every listing they touched read again at the end block, recent
// sales' miners at the block before each sale, and every open listing's miner and whether it can
// be bought, at the end block. Complete, or a stated failure: never part of it. Read only.

import type { Address } from "@foreman/contract";
import {
	BaseError,
	ContractFunctionRevertedError,
	type PublicClient,
	zeroAddress,
} from "viem";
import {
	CIRCUIT_MARKET,
	CIRCUIT_MARKET_IMPLEMENTATION,
	CIRCUIT_MARKET_UPGRADES,
	circuitMarketAbi,
	ERC1967_IMPLEMENTATION_SLOT,
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

/** The getMiner fields the comparables rule needs. Status 1 is mining; task 0 is the unverified pool. */
export interface MarketMinerState {
	status: number;
	taskId: number;
	verifWeight: bigint;
	unverWeight: bigint;
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
			/** Every listing open at the end block, touched or not. */
			states: OpenListingState[];
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
	},
): Promise<MarketScan> {
	const { fromBlock, toBlock } = input;
	const at = { blockNumber: toBlock };
	const concurrency = input.concurrency ?? 50;
	let stage = `market events, blocks ${fromBlock} to ${toBlock}`;
	try {
		const events = await readMarketEvents(client, { fromBlock, toBlock });

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
		const states = await inBatches([...open.values()], concurrency, (l) =>
			readListingState(client, l, at),
		);

		return {
			complete: true,
			fromBlock,
			upToBlock: toBlock,
			upToTime: end.timestamp,
			listingsIssued,
			sales,
			listings,
			states,
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
	return {
		status: m.circuits === zeroAddress ? 0 : m.status,
		taskId: m.taskId,
		verifWeight: m.verifWeight,
		unverWeight: m.unverWeight,
	};
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
	const buyable =
		owner.toLowerCase() === l.seller &&
		(approved.toLowerCase() === CIRCUIT_MARKET || all);
	return { listingId: l.listingId, buyable, miner };
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
