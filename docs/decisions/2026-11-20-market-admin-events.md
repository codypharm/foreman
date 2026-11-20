# The market's admin events: a new upgrade stops the market follow

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, from three options with a recommendation (the recommendation was taken), plus the implementation-slot check, recommended in a follow-up and accepted
- **Amends:** `2026-11-20-market-index.md`, decision 1 ("a log with any other topic stops the follow"): three more events are known, and one of them stops the follow on its own terms

## Context

The first fill of the market index stopped at the market's first block, on an event outside the five its decision 1 knew: `Upgraded(address)`. The five had been confirmed over the last 1,000,000 blocks only. Every log from the market over its whole history (blocks 116,708,167 to 134,720,910, read 20 November 2026) has one of eight topics:

| Event | Count | Where |
| --- | --- | --- |
| `Listed`, `PriceChanged`, `Delisted`, `Sold`, `Withdrawn` | 28,112 / 7,238 / 13,372 / 8,564 / 21 | Throughout; the first `Listed` is at block 116,711,840 |
| `Initialized(uint64)` | 1 | Block 116,708,167, at deployment |
| `OwnershipTransferred(address indexed, address indexed)` | 2 | Block 116,708,167 (none → `0x571d…af15`); block 124,343,347 (`0x571d…af15` → `0xb3d8…3138`, TapeOut's owner) |
| `Upgraded(address indexed implementation)` | 2 | Block 116,708,167 (`0x437d0a6141079554bbaf0d507ac3070c06576647`); block 116,709,020 (`0x725771c38361abef7b844729b978c775f7a83dfb`) |

The ERC-1967 implementation slot holds `0x725771c3…3dfb` at block 116,709,020 and at block 134,720,910: the market's code has not changed since its first 853 blocks. The market's source is not verified, so everything Foreman reads from it (event meanings, `listings(id)`, the 1% fee) was confirmed against that code's behaviour.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Recognise all three; skip `Initialized` and `OwnershipTransferred`; accept the two known upgrades; any other upgrade stops the market follow** | A change to the market's rules can never pass unnoticed | If TapeOut upgrades the market, Sell's market data stops updating until William checks the new code |
| B | Recognise and skip all three | Simplest | An upgrade that changes what a listing means would go unnoticed |
| C | Stop on every `Upgraded` | Strictest | The first fill could not start at the market's first block |

## Decision

**A, with the code checked directly.**

1. **`Initialized` and `OwnershipTransferred` are decoded and skipped.** Neither changes a listing.
2. **Two upgrades are accepted, and only these:** block 116,708,167 to `0x437d0a61…6647` and block 116,709,020 to `0x725771c3…3dfb`. No listing event comes before the second. Any other `Upgraded` stops the market follow, naming its block and the new implementation.
3. **Every market scan reads the ERC-1967 implementation slot at its end block** and stops unless it is `0x725771c3…3dfb`. One storage read; it catches an upgrade even if the code didn't announce it, because the source isn't verified.
4. **A stop is the market's alone.** The rest of the index keeps following. Sell shows its market data with the block it was last read at, never figures read under code nobody checked. Accepting a new implementation is William's call, recorded in a new ADR, after its events and `listings(id)` are confirmed again.

## Consequences

- `packages/chain-bnb`: the market ABI gains the three events; the event reader returns them; the market scan carries the accepted upgrades and implementation and stops on anything else.
- `CLAUDE.md`, "On-chain facts": the market's implementation, its admin events and its whole-history event counts.
