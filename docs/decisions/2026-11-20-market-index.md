# The market index: sales and open asks, followed with the circuit index

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, from three options with a recommendation (the recommendation was taken)
- **Builds on:** `2026-11-20-sell-comparables.md` (what Sell needs), `2026-11-20-circuit-index.md` (decision 5, the 5-minute follow), `2026-11-18-api-and-jobs.md` (Postgres, pg-boss)

## Context

The Sell comparables rule needs every sale on TapeOut's circuit market in the last 14 days with the sold miner's state at the block before the sale, and every open ask with the listed miner's state now. Read on each request, that is too slow:

| Read | Cost, measured 20 November 2026 |
| --- | --- |
| 14 days of `Sold` logs | About 13,400 reads in the market reader's 200-block chunks; 54 reads in 50,000-block chunks on the archive node |
| Sold miners' state | One `getMiner` per sale at the block before it: 425 sales in 14 days, 145 of them by miners that were mining |
| The open book | 28,111 listing ids issued (`nextListingId` at block 134,713,299); reading the latest 3,000 one by one with `getMiner` for each open one took about 40 minutes; 569 were open |

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **The 5-minute follow also indexes market events: new sales with their miner's state, and the open book kept current from listing events** | Sell reads Postgres: fast, and every figure keeps its block. New sales are about 10 a day | More follow code; the book depends on catching every listing event |
| B | A separate job rebuilds the whole market every N minutes | Simpler code | Repeats most reads each run; asks lag by up to N minutes |
| C | Read on each request, cached by block | No new storage | The first request after the cache expires takes minutes |

## Decision

**A.**

1. **Market events, all five, from one log read.** The follow reads every log from the market address from its last block + 1 to the finalized block, in 50,000-block chunks on the archive node, and decodes them by topic: `Listed`, `PriceChanged`, `Delisted`, `Sold` and `Withdrawn` (the owner taking out fees; ignored). A log with any other topic stops the follow with an error, never a skip: an event nobody decoded could open or close a listing.
2. **Sales.** Each `Sold` is saved with its block, time, transaction and log index, listing id, processor, token id, buyer and price (seller proceeds + fee), and the sold miner's `getMiner` at the block before: status, task, verified and unverified weight. Sales are kept, never deleted; Sell takes the last 14 days.
3. **Open asks.** Every listing id touched by an event in the range is read again with `listings(id)` at the follow's block: open with its seller, processor, token id and price, or gone (the market zeroes a sold or withdrawn listing). The meaning of `Delisted`'s bool doesn't matter, because the listing itself is read.
4. **The listed miners' state, every follow.** A miner can stop or start mining with no market event, so every open listing's `getMiner` is read again at the follow's block. About 570 calls today (three times that with rule 7), sent as one batched JSON-RPC request (viem's HTTP batching), never through a Multicall contract, whose address is not in "On-chain facts".
5. **First fill.** Every market event from the market's first block (found by its code, as for the processor factory), so the book is built from its whole history, with a count check: listing ids from `Listed` events = `nextListingId` at the end block. Open listings are then read at the end block as in 3 and 4. Sales get their miner's state for the last 14 days only; older sales are stored without it and never used as comparables.
6. **Freshness and failure.** The market part follows from its own last block, like the other parts. A failed read stops it with the stage named, and nothing from that part is saved; Sell then states the block its comparables were read at, never a silent stale figure. An empty log read for a range that should have events is checked against a known event, as for the tape-out scan (`CLAUDE.md`, "RPC correction").

7. **An ask that can't be bought is not an ask.** The market holds no NFTs: if a seller moves the miner or revokes the market's approval, the listing stays open and a purchase reverts (`docs/notes/2026-11-19-xlayer-market-findings.md`). Each follow reads, for every open listing at the same block and in the same batch as 4, the processor's `ownerOf(tokenId)` and whether the market may move it (`getApproved(tokenId)` or `isApprovedForAll(seller, market)`). A listing whose seller no longer holds the miner, or that the market can't move, is stored as not buyable and never shown as an ask or used in a range; the rule text says so. No contract change (William, a follow-up question: "check and drop"; the alternatives were counting them on screen, a contract change, or not checking).

## Consequences

- `packages/chain-bnb`: the market ABI gains `Listed`, `PriceChanged`, `Delisted` and `Withdrawn` with their indexed fields; a reader for a range of market events.
- `packages/index`: a migration for market sales, listings and the market's last block; the follow gains a market stage after revokes; a script for the first fill.
- The comparables rule (`packages/valuation`) reads its sales and asks from the index.
- `CLAUDE.md`, "On-chain facts": the market's event signatures, confirmed 20 November 2026.
