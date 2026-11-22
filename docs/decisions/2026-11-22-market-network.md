# The market follow stores the network at its block

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-api-endpoints.md` (decision 3), `2026-11-20-market-index.md`, `2026-11-22-market-follow-block.md`

## Context

Each listing row on the listings page shows "≈ X BEM / 30 days" from the miner weight stored with the listing, and the page makes no live reads (`2026-11-21-api-endpoints.md`, decision 3). The value model needs the miner and the network read at the same block (`valueMiner` refuses otherwise). The listings' miners are stored at the market's block, but nothing stored the network at that block.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Store it with the market** | Every row's value uses its weight's block; the page makes no live reads | One migration, one more read per follow |
| B | One live read per page request, cached a minute | No schema change | A live read on the listings page, against decision 3; the page fails when the node does |

## Decision

**A**, chosen by William in a grilling on 22 Nov 2026.

- **The read:** the market scan reads the network (`totalVerifWeight`, `totalUnverWeight`, `minerCount`, `verifMinerCount`) at its end block, after the listings. A failed read fails the scan, so nothing is saved, as for any other read in it.
- **The storage:** the follow saves the four figures in `index_state` beside `market_up_to_block` and `market_up_to_time`, in the same transaction as the listings (migration 011). `readMarketNetwork` gives them back as a `NetworkState` read at the market's block.
- **Before it's stored:** the figures are empty until the first follow after migration 011. `readMarketNetwork` then returns nothing, and the listings page can't value its rows. It answers "not ready", never a zero.
