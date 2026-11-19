// TapeOut's circuit market on BNB Smart Chain: asks (listings) and completed sales.
// There are no bids on this market. What Sell shows without one is in
// docs/decisions/2026-11-19-sell-without-bids.md. Prices are BNB wei, never BEM.

import {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import { type PublicClient, zeroAddress } from "viem";
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
