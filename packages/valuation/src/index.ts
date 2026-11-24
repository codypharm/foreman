// Valuation engine: expected output, low / base / high ranges, backtests.
// Built test first (see CLAUDE.md, "Tests that are not optional").
// Token amounts are bigint base units (BEM has 8 decimals), never number.

export {
	BACKTEST_MINER_WEIGHT,
	type Backtest,
	type BacktestSummary,
	type BacktestWindow,
	backtest,
} from "./backtest.ts";
export { BACKTEST_RESULT } from "./backtest-result.ts";
export {
	ASK_CEILING,
	type MarketAsk,
	type MarketMinerState,
	type MarketSale,
	type Pool,
	SALES_WINDOW_SECONDS,
	type SellMarket,
	sellComparables,
} from "./comparables.ts";
export { emissionBetween, FIRST_HALVING } from "./emission.ts";
export { ValuationInputError } from "./errors.ts";
export { type DailySample, growthRates } from "./growth.ts";
export { expectedOutput } from "./output.ts";
export { type PaybackInput, payback } from "./payback.ts";
export { projectedOutput } from "./projection.ts";
export { outputRange } from "./range.ts";
export { type RentOffer, rentOffer } from "./rent-offer.ts";
export { type SellOffer, sellOffer } from "./sell-offer.ts";
export {
	MODEL_VERSION,
	type ValuedMiner,
	valueMiner,
} from "./value-miner.ts";
