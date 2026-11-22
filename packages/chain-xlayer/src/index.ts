// X Layer reader: RIG vouchers and TapePool's Lend offers. Read only.
// Decisions: docs/decisions/2026-11-19-chain-readers.md, 2026-11-20-lend-from-tapepool.md.

export { RIG_VOUCHER, TAPEPOOL_FACTORY } from "./abi.ts";
export {
	type LendOffer,
	readLendOffers,
	readVoucher,
	type Voucher,
} from "./lend.ts";
