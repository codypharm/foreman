// Originality: netlist reader, hashing, copy and wrapper checks. Built test first against
// fixtures/ (docs/decisions/2026-11-20-copy-and-wrapper-rules.md and
// 2026-11-20-verdict-scope-and-earliest-design.md).

export { type CanMineRead, readCanMine, STOP_COOLDOWN } from "./can-mine.ts";
export {
	bnbBlockOf,
	type CircuitIndex,
	type CopyCheck,
	checkCopy,
	type IndexEntry,
} from "./check-copy.ts";
export {
	type CircuitId,
	checkWrapper,
	MAX_CHAIN_STEPS,
	type NetlistSource,
	type WrapperCheck,
} from "./check-wrapper.ts";
export { type FabxMinerState, fabxCanMine } from "./fabx-can-mine.ts";
export {
	type CommitmentCheck,
	type CommitmentEvent,
	confirmCommitment,
	type MinerCommitment,
} from "./fabx-commitment.ts";
export {
	HASH_RULE_VERSION,
	hashNetlist,
	type NetlistHashes,
} from "./hash.ts";
export {
	buildOriginality,
	CROSS_CHAIN_RULE_VERSION,
	circuitRef,
	ORIGINALITY_RULES,
	type OriginalityVerdictResult,
	originalityVerdict,
	RULE_VERSION,
} from "./originality.ts";
export {
	decodeNetlist,
	type Netlist,
	type NetlistRead,
	type NetlistRecord,
	readNetlist,
} from "./read-netlist.ts";
export {
	type MinerRevoke,
	type MinerRevokeScan,
	REVOKED,
	scanMinerRevokes,
} from "./scan-miner-revokes.ts";
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
	FACTORY,
	FACTORY_FIRST_BLOCK,
	type ListedProcessor,
	LOG_SPAN,
	scanTapeOuts,
	TAPED_OUT,
	type TapeOut,
	type TapeOutScan,
} from "./scan-tape-outs.ts";
