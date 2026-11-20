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
export { type LoadedIndex, loadCircuitIndex } from "./load-index.ts";
export { migrate } from "./migrate.ts";
export {
	backfillCommitments,
	type CommitmentBackfillResult,
	type CompleteMinerStartScan,
	readMiners,
	type StoredMiner,
	saveMinerStarts,
} from "./miners.ts";
export {
	type CompleteScan,
	readIndex,
	type StoredIndex,
	type StoredTapeOut,
	saveScan,
} from "./store.ts";
