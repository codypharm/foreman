# The market's listing reads go in Multicall3 bundles

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-20-market-index.md`, `2026-11-22-market-follow-block.md`, `2026-11-21-bnb-nodes.md`

## Context

Every follow reads every open listing's state again at the market's block. That's 4 calls per listing: the miner (`getMiner`), `ownerOf`, `getApproved` and `isApprovedForAll`. On 22 Nov 2026 there were 6,179 open listings, about 25,000 calls. The follow that caught the index up spent about 20 of its 22.5 minutes on them, on publicnode. A follow every 5 minutes can't do that.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Multicall3 bundles** | The same reads at the same block, about 25,000 calls in about 62. Small change, in one place | A contract not yet in "On-chain facts" |
| B | Re-read only listings something touched | No new contract | Complex; a missed case shows a listing as buyable when it isn't |
| C | All listings hourly, touched ones every follow | Simple | Listings at different blocks: breaks one market block for values and the stored network |

## Decision

**A**, chosen by William.

- **The contract:** Multicall3 at `0xca11bde05977b3631167028862be2a173976ca11`, confirmed on 22 Nov 2026 and added to "On-chain facts" with William's yes. Sourcify has an exact match of its creation and runtime code on chain 56. Its runtime code is byte-identical to Ethereum's at the same address. It's not a proxy, and its source has no self-destruct or delegatecall.
- **Bundles:** 100 listings to a bundle (400 reads in one `aggregate3` call at the market's block), 4 bundles at a time, listings in id order so the same listings always make the same bundles.
- **A failed read is read again on its own.** Every read in a bundle may fail without failing the bundle. A listing with any failed read is read again on its own through the old path, where a contract revert means "can't be bought" and anything else fails the scan. So a read starved of gas inside a bundle is never taken for a revert, and is never shown as "can't be bought".
- **Unchanged:** sold miners are still read one by one, at the block before each sale, and the result of a scan is the same.

## What follows

- The scan's fixture gained the one bundle call, recorded at block 134,713,299 from the archive node; its old single calls stay for the fallback test. Tests cover the bundle failing, one read in it failing (read again, same answer), and that read failing on its own too (the scan stops).
- The first follow with bundles gives the real time. Revisit if it's still too slow for a 5-minute follow.
