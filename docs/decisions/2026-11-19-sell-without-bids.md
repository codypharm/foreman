# Sell without bids: show completed sales and asks; selling means listing

- **Date:** 19 November 2026
- **Status:** Accepted
- **Decided by:** Furqaan
- **Narrows:** `2026-11-19-offer-venues.md` (the case it left open: what Sell shows when there is no bid)
- **Facts:** `docs/notes/2026-11-19-xlayer-market-findings.md`, addendum on the BNB Chain miner market

## Context

There is no live bid for a miner on either chain. TapeOut's circuit market on BNB Chain only takes listings, OwlGate's offer book is empty, and the X Layer RIG book has nothing in it. What does exist is real: 91 active asks for mining miners from 23 sellers, and the history of completed sales (`Sold` events), all priced in BNB.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **"No bid right now", then recent completed sales of comparable miners and the asking range of similar listings, each labelled; selling means the owner lists and signs** | Uses everything real; gives the owner a price to list at | Asks include junk (up to 888 BNB), so they need a sensible filter, and that filter must be stated |
| B | No bid, plus completed sales only | Simpler; sales are real transactions | Hides what competing sellers ask |
| C | Strictly "no live bid" | Cleanest | Sell is empty for every miner |

## Decision

**A.**

- **The headline is always the bid:** "No bid right now" until a bid exists. Never a sale price or an ask dressed up as a bid.
- **Below it, labelled:**
  - **Completed sales:** recent `Sold` prices for comparable miners, as BNB per unit of weight, with their dates.
  - **Asks:** the range other owners list similar miners at, saying how many listings the range comes from.
- **Selling means listing.** Foreman shows the listing for the owner to sign on TapeOut's circuit market. The owner picks the price; Foreman can suggest one from the comparisons, labelled as a suggestion. An agent key never lists or sells (`2026-11-19-data-contract.md`).
- **In BEM:** prices are in BNB. A BEM figure uses today's BNB and BEM prices and says so (`2026-11-18-valuation-model.md`).
- **"Comparable" and the ask filter are code, stated on screen:** for example "same processor, weight within ±50%, last 30 days; asks above 10× the median sale per weight are left out". The exact rule is settled with the backtest, but it is never a model call.

## Consequences

- `docs/PRODUCT.md`: Sell changes from "best live bid against the estimated value range" to "the live bid if any; otherwise recent sales and asks of comparable miners, and a listing the owner signs".
- **`Offer` gains a Sell-side context** (`sales` and `asks` beside the bid, which can be `none`). That is a contract change, made when `Offer` is built from the market reader.
- The BNB reader gains a market reader: active listings (`listings(id)`) and completed sales (`Sold` events). Sales older than about a week need the archive key (`2026-11-19-chain-readers.md`).
- Demo step 2 still compares Hold, Lend and Sell. Sell shows "no bid", the comparison and the listing button.
