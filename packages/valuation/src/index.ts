// Valuation engine: expected output, low / base / high ranges, backtests.
// Built test first (see CLAUDE.md, "Tests that are not optional").
// Token amounts are bigint base units (BEM has 8 decimals), never number.

export {
	type MarketAsk,
	type MarketMinerState,
	type MarketSale,
	type Pool,
	sellComparables,
} from "./comparables.ts";
export { emissionBetween } from "./emission.ts";
export { ValuationInputError } from "./errors.ts";
export { expectedOutput } from "./output.ts";
export { projectedOutput } from "./projection.ts";
export { outputRange } from "./range.ts";
