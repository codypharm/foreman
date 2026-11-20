// The circuit index's storage: migrations, saving a scan, reading the index back
// (docs/decisions/2026-11-20-database-access.md).

export { migrate } from "./migrate.ts";
export {
	type CompleteScan,
	readIndex,
	type StoredIndex,
	saveScan,
} from "./store.ts";
