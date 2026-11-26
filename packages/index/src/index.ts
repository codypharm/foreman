// The circuit index's storage: migrations, saving a scan, reading the index back
// (docs/decisions/2026-11-20-database-access.md).

export {
	type ApiKeyHolder,
	type ApiKeyRecord,
	createApiKey,
	findApiKey,
	readApiKeys,
	recordApiUsage,
	revokeApiKey,
} from "./api-keys.ts";
export {
	type BackfillOptions,
	type BackfillResult,
	backfillNetlists,
	readStoredNetlist,
	type StoredNetlist,
} from "./backfill.ts";
export {
	backfillFabxNetlists,
	type FabxMinerRecord,
	type FabxState,
	FREEZING,
	fillFabxClaimTimes,
	type Reviewed,
	readFabxMiner,
	readFabxMinerCircuits,
	readFabxState,
	saveFabxHistory,
	saveFabxMiners,
} from "./fabx.ts";
export { type FabxFollow, followFabx } from "./fabx-follow.ts";
export {
	type FillResult,
	fillCommitmentTimes,
	fillTapeOutTimes,
} from "./fill-times.ts";
export { type FollowResult, followIndex } from "./follow.ts";
export { fillListingTimes, type ListingTimesResult } from "./listing-times.ts";
export {
	type LoadedIndex,
	loadCircuitIndex,
	readCircuitRef,
} from "./load-index.ts";
export {
	findListingCircuit,
	findMinerCircuit,
	type ListingLookup,
	type MinerLookup,
} from "./lookup.ts";
export {
	followMarket,
	type MarketBook,
	type MarketFollowResult,
	marketRead,
	type OpenListing,
	readCircuitListing,
	readMarketBook,
	readMarketNetwork,
	readOpenListings,
	readSellMarket,
	type StoredListingMiner,
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
	type CompleteOwnerScan,
	followOwners,
	type IndexedMiner,
	isMint,
	type OwnerFollowResult,
	readCircuitOwners,
	readHeldMiners,
	readIndexedMiner,
	type StoredOwner,
	type StoredOwners,
	saveOwnerScan,
} from "./owners.ts";
export {
	type PublishedEntry,
	type PublishedRow,
	type ResultsContract,
	readPublished,
	readPublishedRow,
	recordPublished,
} from "./published.ts";
export {
	circuitsTouchedSince,
	type ResultsState,
	readAllStoredResults,
	readResultsIndex,
	readResultsState,
	readStoredCircuits,
	readStoredResult,
	type StoredResult,
	saveResults,
} from "./results.ts";
export {
	type CompleteScan,
	readIndex,
	type StoredIndex,
	type StoredTapeOut,
	saveScan,
} from "./store.ts";
export {
	type FollowOutcome,
	followAddress,
	readFollows,
	readSent,
	recordSent,
	stopChat,
	type TelegramFollow,
	unfollowAddress,
} from "./telegram-follows.ts";
export {
	type PublisherBalance,
	readPublisherBalance,
	readStages,
	recordPublisherBalance,
	recordStage,
	type StageEvent,
	type StageRecord,
	type StageState,
	WORKER_STAGES,
	type WorkerStage,
} from "./worker-stages.ts";
