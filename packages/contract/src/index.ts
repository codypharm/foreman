// The data contract's types and parsers. Shapes: docs/data-contract.md (owned by Furqaan).

export { ContractParseError } from "./errors.ts";
export {
	type ChainId,
	parseChainId,
	parseSourced,
	type Sourced,
	serialiseSourced,
} from "./sourced.ts";
export {
	type Address,
	type Hex32,
	parseAddress,
	parseHex32,
	parseUint,
	serialiseUint,
} from "./wire.ts";
