// BNB reader: Miner and NetworkState from the PoD mining contract on BNB Smart Chain.
// Read only. Decisions: docs/decisions/2026-11-19-chain-readers.md.

export {
	BEM,
	BEM_WBNB_POOL,
	CIRCUIT_MARKET,
	CIRCUIT_MARKET_FIRST_BLOCK,
	CIRCUIT_MARKET_IMPLEMENTATION,
	CIRCUIT_MARKET_UPGRADES,
	MULTICALL3,
	multicall3Abi,
	POD_MINING,
	PROCESSOR_MULTIPLIERS,
	podMiningAbi,
	WBNB,
} from "./abi.ts";
export { type BemPriceRead, readBemPrice } from "./bem-price.ts";
export {
	bnbClient,
	bnbTransport,
	PUBLIC_RECENT_RPC,
	RECENT_BLOCKS,
} from "./bnb-client.ts";
export { ChainReadError, UnknownMinerError } from "./errors.ts";
export { blockAtOrAfter, readNetworkHistory } from "./history.ts";
export {
	type MarketEvent,
	type MarketEventAt,
	type MarketListing,
	type MarketSale,
	readActiveListings,
	readListing,
	readMarketEvents,
	readSales,
} from "./market.ts";
export { minerKey } from "./miner-key.ts";
export {
	PROCESSOR_FACTORY,
	type ProcessorAtRead,
	readProcessorAt,
} from "./processor-at.ts";
export { readMiner } from "./read-miner.ts";
export { readNetworkState } from "./read-network.ts";
export {
	type MarketMinerState,
	type MarketSaleEvent,
	type MarketScan,
	type OpenListingState,
	type ScannedListing,
	type ScannedSale,
	scanMarket,
} from "./scan-market.ts";
export {
	type CircuitTransfer,
	type CircuitTransferScan,
	scanCircuitTransfers,
	TRANSFER,
} from "./scan-transfers.ts";
