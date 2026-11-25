// X Layer reader: RIG vouchers and TapePool's Lend offers. Read only.
// Decisions: docs/decisions/2026-11-19-chain-readers.md, 2026-11-20-lend-from-tapepool.md.

export { RIG_VOUCHER, TAPEPOOL_FACTORY } from "./abi.ts";
export {
	type HeldVoucher,
	type HeldVouchers,
	readHeldVouchers,
} from "./held-vouchers.ts";
export {
	type LendOffer,
	readLendOffers,
	readVoucher,
	VOUCHER_READS_AT_ONCE,
	type Voucher,
} from "./lend.ts";
export { readVoucherCircuit, type VoucherCircuit } from "./voucher-circuit.ts";
export {
	decodeFabxLogs,
	FABX_FIRST_BLOCK,
	FABX_MINING,
	FABX_PROCESSOR,
	FABX_TOPICS,
	type FabxCommitment,
	type FabxContractEvent,
	type FabxContractEventKind,
	type FabxHistory,
	type FabxStart,
	type FabxTapeOut,
	type LogAt,
} from "./fabx-events.ts";
export {
	type LogNode,
	type LogRead,
	readLogs,
	XLAYER_LOG_BLOCKS,
	type XLayerLog,
} from "./read-logs.ts";
export {
	FABX_MINER_FIXTURE_IDS,
	type FabxMinerRecord,
	type FabxMinersRead,
	type FabxMinerStatus,
	readFabxMiners,
} from "./fabx-miners.ts";
