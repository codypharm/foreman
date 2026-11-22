# The market follow reads its listings near the head

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-20-market-index.md`, `2026-11-21-bnb-nodes.md`

## Context

The follow picks one finalized block when it starts and reads every part of the index up to it. The market's part comes last. It reads the market's events, then every open listing's state at that block: about 6,200 listings, about 25,000 calls.

On 21 and 22 Nov 2026 the index had fallen about 41,000 blocks behind. The market's event read went through Alchemy, 10 blocks a call, and took 43 minutes. By then the follow's block was more than 5,000 blocks old, so the listing reads went to Alchemy too. Alchemy's free tier refused the burst, and the market stage failed with "open listings at block 134944823: HTTP request failed". Each rerun starts further behind, so it would fail the same way.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Read on to the head first** | Listing reads go to publicnode and take minutes | The market's block can be later than the rest of the index's |
| B | Throttle old reads on Alchemy | One block for every part | About 25 minutes and about 650,000 of Alchemy's 30 million monthly units on every catch-up |

## Decision

**A**, chosen by William. After reading its events up to the follow's block, the market scan asks for the latest finalized block and reads events on to it. It repeats this until a round covers 1,000 blocks or fewer, at most 5 rounds. Only then does it make any state read: the listings events touched, sold miners, and every open listing, all at the block it reached. Each round covers the time the last one took, so the rounds shrink fast, and the last ones go to publicnode.

- **Two blocks, both stored.** The market is stored at its own block (`market_up_to_block`); the rest of the index stays at the follow's (`up_to_block`). They were already separate columns, and a page already reads BNB at the market's block.
- **Unchanged without a head.** A scan given no head to catch up to reads everything at the block it was given, as before. The tests' saved fixtures rely on that.

## What follows

- `scanMarket` takes `catchUpTo`; the follow script passes the latest finalized block.
- Revisit if the other stages' reads at the follow's block start failing the same way after a long catch-up.
