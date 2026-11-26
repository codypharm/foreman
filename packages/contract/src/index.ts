// The data contract's types and parsers. Shapes: docs/data-contract.md (owned by Furqaan).

export {
	API_ERRORS,
	type ApiError,
	parseApiError,
	serialiseApiError,
} from "./api-error.ts";
export {
	type ListingAsk,
	MULTIPLIERS,
	type Multiplier,
	type Published,
	type PublishedAt,
	parseListingAsk,
	parseMultiplier,
	parsePublished,
	parseStoredCheck,
	type StoredCheck,
	serialiseListingAsk,
	serialisePublished,
	serialiseStoredCheck,
} from "./api-shared.ts";
export {
	BEM_PRICE_AVERAGED_OVER,
	type BemPrice,
	parseBemPrice,
	serialiseBemPrice,
} from "./bem-price.ts";
export type { BnbRead } from "./bnb.ts";
export {
	BULK_MAX,
	type BulkCircuit,
	type BulkRequest,
	type BulkResult,
	type BulkResults,
	parseBulkRequest,
	parseBulkResults,
	serialiseBulkRequest,
	serialiseBulkResults,
} from "./bulk-results.ts";
export {
	type CheckAnswer,
	parseCheckAnswer,
	serialiseCheckAnswer,
} from "./check-answer.ts";
export {
	type BnbCircuitPage,
	type CircuitPage,
	type FabxCircuitPage,
	isFabxPage,
	parseCircuitPage,
	serialiseCircuitPage,
} from "./circuit-page.ts";
export { ContractParseError } from "./errors.ts";
export {
	LISTING_VERDICTS,
	LISTINGS_PAGE_SIZE,
	type ListingRow,
	type ListingsPage,
	type ListingVerdict,
	parseListingsPage,
	serialiseListingsPage,
} from "./listings-page.ts";
export { type Miner, parseMiner, serialiseMiner } from "./miner.ts";
export {
	type NetworkState,
	parseNetworkState,
	serialiseNetworkState,
} from "./network.ts";
export {
	type Amount,
	type ChainRead,
	COMPARABLES_MINIMUM,
	type Comparable,
	type Comparables,
	type ComparablesRange,
	type Currency,
	type LendNoneReason,
	type Offer,
	parseOffer,
	type SellBid,
	serialiseOffer,
	TAPEPOOL_REASONS,
	type TapePoolReason,
	type Venue,
} from "./offer.ts";
export {
	bnbIndexBlock,
	type CantMineReason,
	type CircuitRef,
	designedEarlier,
	indexBlock,
	type Originality,
	type OriginalityFact,
	type OriginalityIndex,
	type OriginalityVerdict,
	parseCircuitRef,
	parseOriginality,
	parseOriginalityIndex,
	STOP_COOLDOWN_BLOCKS,
	serialiseOriginality,
	WRAPPER_STEP_LIMIT,
} from "./originality.ts";
export { type Payback, parsePayback, serialisePayback } from "./payback.ts";
export { type Price, parsePrice, serialisePrice } from "./price.ts";
export {
	type ChainId,
	parseChainId,
	parseSourced,
	type Sourced,
	serialiseSourced,
} from "./sourced.ts";
export {
	type Backtest,
	parseValuation,
	type Scenario,
	serialiseValuation,
	type Valuation,
} from "./valuation.ts";
export {
	type CopyAlert,
	type CopyListing,
	JUST_LISTED_SECONDS,
	parseWalletMiners,
	serialiseWalletMiners,
	type WalletMiner,
	type WalletMiners,
} from "./wallet-miners.ts";
export {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
	parseUint,
	serialiseUint,
} from "./wire.ts";
