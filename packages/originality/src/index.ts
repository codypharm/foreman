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
export { hashNetlist, type NetlistHashes } from "./hash.ts";
export {
	type Netlist,
	type NetlistRead,
	type NetlistRecord,
	readNetlist,
} from "./read-netlist.ts";
export {
	type CountMismatch,
	type DroppedEvent,
	scanTapeOuts,
	type TapeOut,
	type TapeOutScan,
} from "./scan-tape-outs.ts";
