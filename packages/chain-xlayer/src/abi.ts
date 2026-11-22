// X Layer addresses and the ABI fragments Foreman reads. Every address is in CLAUDE.md's
// "On-chain facts"; TapePool is a third party (docs/decisions/2026-11-20-lend-from-tapepool.md).

import { parseAbi } from "viem";

/** The RIG voucher: one voucher = one miner held in the BNB Chain rig vault. */
export const RIG_VOUCHER =
	"0x9cfc959cd42b2e1d39a0d850c528210e818ae520" as const;
/** TapePool's live account factory (its fourth deployment). The pool comes from its `pool()`. */
export const TAPEPOOL_FACTORY =
	"0xa9014e27dd17ea30e4fa4f71934645b9dcef8ac8" as const;

export const rigVoucherAbi = parseAbi([
	"function totalSupply() view returns (uint256)",
	"function tokenByIndex(uint256 index) view returns (uint256)",
	"function ownerOf(uint256 id) view returns (address)",
	"function balanceOf(address owner) view returns (uint256)",
	"function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
	"function rigs(uint256 id) view returns (address circuits, uint64 syncedAt, uint256 circuitId, uint256 power)",
]);

export const tapePoolFactoryAbi = parseAbi([
	"function isAgent(address account) view returns (bool)",
	"function pool() view returns (address)",
]);

/** TapePool's quote calculator ("TapeLens"). */
export const TAPEPOOL_LENS =
	"0xfcc669bc9cca397cb01804035d5be981d7389ef2" as const;

export const tapePoolAccountAbi = parseAbi([
	"function pool() view returns (address)",
]);

export const tapeLensAbi = parseAbi([
	"function collateralOf(address agent) view returns (uint256[])",
	"function quote(address agent, uint8 term) view returns ((uint256 maxPrincipal, uint256 fee, uint256 expected, uint16 inputBits, uint8 reason, uint256 pending, uint256 opsFee))",
]);
