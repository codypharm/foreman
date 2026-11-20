// Originality: netlist reader, hashing, copy and wrapper checks. Built test first against
// fixtures/ (docs/decisions/2026-11-20-copy-and-wrapper-rules.md and
// 2026-11-20-verdict-scope-and-earliest-design.md).

export {
	type CircuitIndex,
	type CopyCheck,
	checkCopy,
	type IndexEntry,
} from "./check-copy.ts";
export {
	type CircuitId,
	checkWrapper,
	MAX_CHAIN_STEPS,
	type WrapperCheck,
} from "./check-wrapper.ts";
export {
	HASH_RULE_VERSION,
	hashNetlist,
	type NetlistHashes,
} from "./hash.ts";
export {
	type Netlist,
	type NetlistRead,
	type NetlistRecord,
	readNetlist,
} from "./read-netlist.ts";
export {
	type CommitmentRead,
	MINING_FIRST_BLOCK,
	type MinerStart,
	type MinerStartScan,
	minerKey,
	readDesignCommitment,
	scanMinerStarts,
} from "./scan-miner-starts.ts";
export {
	type CountMismatch,
	type DroppedEvent,
	FACTORY_FIRST_BLOCK,
	type ListedProcessor,
	scanTapeOuts,
	type TapeOut,
	type TapeOutScan,
} from "./scan-tape-outs.ts";
