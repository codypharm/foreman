// TapeOut's circuit market on BNB Smart Chain: asks (listings) and completed sales.
// There are no bids on this market. What Sell shows without one is in
// docs/decisions/2026-11-19-sell-without-bids.md. Prices are BNB wei, never BEM.

import {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import {
	decodeEventLog,
	type Hex,
	hexToBigInt,
	hexToNumber,
	numberToHex,
	type PublicClient,
	zeroAddress,
} from "viem";
import { CIRCUIT_MARKET, circuitMarketAbi } from "./abi.ts";
import { ChainReadError } from "./errors.ts";

export interface MarketListing {
	listingId: bigint;
	seller: Address;
	/** The miner's NFT contract. */
	processor: Address;
	tokenId: bigint;
	/** The asking price, BNB wei. */
	priceWei: bigint;
	/** The market's fee, in basis points (100 = 1%). */
	feeBps: number;
}

export interface MarketSale {
	listingId: bigint;
	buyer: Address;
	processor: Address;
	tokenId: bigint;
	/** What the buyer paid, BNB wei: seller proceeds + fee. */
	priceWei: bigint;
	feeWei: bigint;
	block: bigint;
	tx: Hex32;
}

/** One listing, or null when it sold or was withdrawn (the market zeroes it). */
export async function readListing(
	client: PublicClient,
	listingId: bigint,
	at: { blockNumber: bigint },
): Promise<MarketListing | null> {
	const [seller, processor, price, feeBps, tokenId] = await client.readContract(
		{
			address: CIRCUIT_MARKET,
			abi: circuitMarketAbi,
			functionName: "listings",
			args: [listingId],
			blockNumber: at.blockNumber,
		},
	);
	if (seller === zeroAddress) return null;
	if (feeBps > 10_000n) {
		throw new ChainReadError(
			`Listing ${listingId} has a fee of ${feeBps} bps, above 100%`,
		);
	}
	return {
		listingId,
		seller: parseAddress(seller.toLowerCase(), "listing.seller"),
		processor: parseAddress(processor.toLowerCase(), "listing.processor"),
		tokenId,
		priceWei: price,
		feeBps: Number(feeBps),
	};
}

/**
 * The open asks among the latest `latest` listing ids, newest first. Sequential, to stay
 * inside public RPC limits. Old listings are mostly sold or withdrawn, so a window of recent
 * ids covers the live book.
 */
export async function readActiveListings(
	client: PublicClient,
	at: { blockNumber: bigint; latest: number },
): Promise<MarketListing[]> {
	if (!Number.isSafeInteger(at.latest) || at.latest < 1) {
		throw new RangeError(
			`latest must be a whole number of 1 or more, got ${at.latest}`,
		);
	}
	const newest = await client.readContract({
		address: CIRCUIT_MARKET,
		abi: circuitMarketAbi,
		functionName: "nextListingId",
		blockNumber: at.blockNumber,
	});
	const asks: MarketListing[] = [];
	const oldest = newest - BigInt(at.latest) + 1n;
	for (let id = newest; id >= oldest && id >= 1n; id--) {
		const listing = await readListing(client, id, at);
		if (listing) asks.push(listing);
	}
	return asks;
}

/** Completed sales in [fromBlock, toBlock], oldest first, read in 200-block chunks (CLAUDE.md, "RPC notes"). */
export async function readSales(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
): Promise<MarketSale[]> {
	const { fromBlock, toBlock } = range;
	if (toBlock < fromBlock) {
		throw new RangeError(
			`toBlock (${toBlock}) is before fromBlock (${fromBlock})`,
		);
	}
	const sales: MarketSale[] = [];
	for (let from = fromBlock; from <= toBlock; from += CHUNK) {
		const to = from + CHUNK - 1n < toBlock ? from + CHUNK - 1n : toBlock;
		const logs = await client.getContractEvents({
			address: CIRCUIT_MARKET,
			abi: circuitMarketAbi,
			eventName: "Sold",
			fromBlock: from,
			toBlock: to,
			strict: true,
		});
		for (const log of logs) {
			const { id, buyer, processor, tokenId, sellerProceeds, fee } = log.args;
			sales.push({
				listingId: id,
				buyer: parseAddress(buyer.toLowerCase(), "sale.buyer"),
				processor: parseAddress(processor.toLowerCase(), "sale.processor"),
				tokenId,
				priceWei: sellerProceeds + fee,
				feeWei: fee,
				block: log.blockNumber,
				tx: parseHex32(log.transactionHash, "sale.tx"),
			});
		}
	}
	return sales;
}

const CHUNK = 200n;

/** Where an event sits in the chain, and its block's time. */
export interface MarketEventAt {
	block: bigint;
	time: bigint;
	tx: Hex32;
	logIndex: number;
}

/** Every event the market emits (2026-11-20-market-index.md, decision 1; 2026-11-20-market-admin-events.md). */
export type MarketEvent =
	| {
			event: "listed";
			listingId: bigint;
			seller: Address;
			processor: Address;
			tokenId: bigint;
			priceWei: bigint;
			at: MarketEventAt;
	  }
	| {
			event: "price-changed";
			listingId: bigint;
			priceWei: bigint;
			at: MarketEventAt;
	  }
	| { event: "delisted"; listingId: bigint; at: MarketEventAt }
	| {
			event: "sold";
			listingId: bigint;
			buyer: Address;
			processor: Address;
			tokenId: bigint;
			/** What the buyer paid, BNB wei: seller proceeds + fee. */
			priceWei: bigint;
			feeWei: bigint;
			at: MarketEventAt;
	  }
	/** The owner taking out the market's fees; about no listing. */
	| { event: "withdrawn"; at: MarketEventAt }
	/** Admin events: deployment and a change of owner change no listing. */
	| { event: "initialized"; at: MarketEventAt }
	| { event: "ownership-transferred"; at: MarketEventAt }
	/** The market's code was swapped: only the known upgrades are accepted (market scan). */
	| { event: "upgraded"; implementation: Address; at: MarketEventAt };

/** Blocks per log read on the archive node (CLAUDE.md, "Tape-out scan"). */
const EVENT_SPAN = 50_000n;

interface RawLog {
	topics: [Hex, ...Hex[]];
	data: Hex;
	blockNumber: Hex;
	transactionHash: Hex;
	logIndex: Hex;
	/** Not every node returns it: a log without one stops the read. */
	blockTimestamp?: Hex;
}

/**
 * Every log from the market in [fromBlock, toBlock], oldest first. Needs the archive node: a
 * node without history returns an empty list, not an error. An event with any other topic, or
 * a log without its block time, throws: an event nobody decoded could open or close a listing.
 */
export async function readMarketEvents(
	client: PublicClient,
	range: { fromBlock: bigint; toBlock: bigint },
): Promise<MarketEvent[]> {
	const { fromBlock, toBlock } = range;
	if (toBlock < fromBlock) {
		throw new RangeError(
			`toBlock (${toBlock}) is before fromBlock (${fromBlock})`,
		);
	}
	const events: MarketEvent[] = [];
	for (let from = fromBlock; from <= toBlock; from += EVENT_SPAN) {
		const to =
			from + EVENT_SPAN - 1n < toBlock ? from + EVENT_SPAN - 1n : toBlock;
		const logs = (await client.request({
			method: "eth_getLogs",
			params: [
				{
					address: CIRCUIT_MARKET,
					fromBlock: numberToHex(from),
					toBlock: numberToHex(to),
				},
			],
		})) as RawLog[];
		for (const log of logs) events.push(decodeMarketLog(log));
	}
	return events.sort((a, b) =>
		a.at.block !== b.at.block
			? a.at.block < b.at.block
				? -1
				: 1
			: a.at.logIndex - b.at.logIndex,
	);
}

function decodeMarketLog(log: RawLog): MarketEvent {
	const block = hexToBigInt(log.blockNumber);
	if (!log.blockTimestamp) {
		throw new ChainReadError(
			`A market log in block ${block} came without its block time`,
		);
	}
	const at: MarketEventAt = {
		block,
		time: hexToBigInt(log.blockTimestamp),
		tx: parseHex32(log.transactionHash, "log.transactionHash"),
		logIndex: hexToNumber(log.logIndex),
	};
	let decoded: ReturnType<typeof decodeEventLog<typeof circuitMarketAbi>>;
	try {
		decoded = decodeEventLog({
			abi: circuitMarketAbi,
			data: log.data,
			topics: log.topics,
			strict: true,
		});
	} catch {
		throw new ChainReadError(
			`A market log in block ${block} (log ${at.logIndex}) has topic ${log.topics[0]}, which is not one of the market's eight events`,
		);
	}
	const address = (a: string, field: string) =>
		parseAddress(a.toLowerCase(), field);
	switch (decoded.eventName) {
		case "Listed": {
			const { id, seller, processor, tokenId, price } = decoded.args;
			return {
				event: "listed",
				listingId: id,
				seller: address(seller, "Listed.seller"),
				processor: address(processor, "Listed.processor"),
				tokenId,
				priceWei: price,
				at,
			};
		}
		case "PriceChanged":
			return {
				event: "price-changed",
				listingId: decoded.args.id,
				priceWei: decoded.args.price,
				at,
			};
		case "Delisted":
			return { event: "delisted", listingId: decoded.args.id, at };
		case "Sold": {
			const { id, buyer, processor, tokenId, sellerProceeds, fee } =
				decoded.args;
			return {
				event: "sold",
				listingId: id,
				buyer: address(buyer, "Sold.buyer"),
				processor: address(processor, "Sold.processor"),
				tokenId,
				priceWei: sellerProceeds + fee,
				feeWei: fee,
				at,
			};
		}
		case "Withdrawn":
			return { event: "withdrawn", at };
		case "Initialized":
			return { event: "initialized", at };
		case "OwnershipTransferred":
			return { event: "ownership-transferred", at };
		case "Upgraded":
			return {
				event: "upgraded",
				implementation: address(
					decoded.args.implementation,
					"Upgraded.implementation",
				),
				at,
			};
	}
}
