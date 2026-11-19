// The data contract's types and parsers. Shapes: docs/data-contract.md (owned by Furqaan).

export type { BnbRead } from "./bnb.ts";
export { ContractParseError } from "./errors.ts";
export { type Miner, parseMiner, serialiseMiner } from "./miner.ts";
export {
	type NetworkState,
	parseNetworkState,
	serialiseNetworkState,
} from "./network.ts";
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
