// The circuit index's storage: migrations, saving a scan, reading the index back
// (docs/decisions/2026-11-20-database-access.md).

export {
	type BackfillResult,
	backfillNetlists,
	readStoredNetlist,
	type StoredNetlist,
} from "./backfill.ts";
export {
	type FillResult,
	fillCommitmentTimes,
	fillTapeOutTimes,
} from "./fill-times.ts";
export { type FollowResult, followIndex } from "./follow.ts";
export {
	type LoadedIndex,
	loadCircuitIndex,
	readCircuitRef,
} from "./load-index.ts";
export {
	followMarket,
	type MarketBook,
	type MarketFollowResult,
	readMarketBook,
	readSellMarket,
} from "./market.ts";
export { migrate } from "./migrate.ts";
export {
	backfillCommitments,
	type CommitmentBackfillResult,
	type CompleteMinerRevokeScan,
	type CompleteMinerStartScan,
	readMiners,
	type StoredMiner,
	saveMinerRevokes,
	saveMinerStarts,
} from "./miners.ts";
export {
	followNetworkDays,
	type NetworkDaysFollowResult,
	readNetworkDays,
	saveNetworkDays,
} from "./network-days.ts";
export {
	type CompleteScan,
	readIndex,
	type StoredIndex,
	type StoredTapeOut,
	saveScan,
} from "./store.ts";
