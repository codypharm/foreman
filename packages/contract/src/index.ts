// The data contract's types and parsers. Shapes: docs/data-contract.md (owned by Furqaan).

export {
	BEM_PRICE_AVERAGED_OVER,
	type BemPrice,
	parseBemPrice,
	serialiseBemPrice,
} from "./bem-price.ts";
export type { BnbRead } from "./bnb.ts";
export { ContractParseError } from "./errors.ts";
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
	type CantMineReason,
	type CircuitRef,
	designedEarlier,
	type Originality,
	type OriginalityFact,
	type OriginalityVerdict,
	parseCircuitRef,
	parseOriginality,
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
	parseValuation,
	type Scenario,
	serialiseValuation,
	type Valuation,
} from "./valuation.ts";
export {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
	parseUint,
	serialiseUint,
} from "./wire.ts";
