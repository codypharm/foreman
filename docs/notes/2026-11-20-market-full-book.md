# The circuit market's full open book, after the first fill

- **Date:** 20 November 2026
- **Read at:** block 134,724,711 (latest finalized), from the market index's first fill (`pnpm fill-market`, 618 s)
- **Bears on:** `docs/decisions/2026-11-20-sell-comparables.md`, rule 6 (the 3× ask ceiling), whose evidence came from the latest 3,000 listing ids only

## The fill matches the chain

| | Index | Chain |
| --- | --- | --- |
| Listings | 28,112 | `nextListingId`; 28,112 `Listed` events over the market's whole history |
| Sales | 8,564 | 8,564 `Sold` events |
| Open listings | 6,176 | Each re-read with `listings(id)` at the end block |
| Open and buyable | 5,899 | Owner is the seller and the market is approved, at the end block |

Sales in the last 14 days: 423, of which 146 were miners that were mining at the block before the sale (141 verified, 5 unverified). The ADR's evidence had 425 / 145 / 140 / 5 a few hours earlier.

## The open book is much larger than the ADR's evidence

The ADR read open asks from the latest 3,000 listing ids, on the old reader's assumption that older listings are mostly sold or withdrawn. They aren't: 5,607 of the 6,176 open listings are older than the latest 3,000 ids (5,497 of them buyable). The latest 3,000 hold 569 open listings, the same as the ADR's snapshot.

| | ADR evidence (latest 3,000 ids, block 134,713,299) | Full book (block 134,724,711) |
| --- | --- | --- |
| Buyable verified asks for miners that are mining | 95 | 250 (173 older than the latest 3,000) |
| Median verified sale, BNB per unit of weight | 0.0358 | 0.0359 |
| Ceiling (3× the median) | 0.1076 | 0.1076 |
| Left out, over the ceiling | 5 | 127 |
| Kept | 90 | 123 |
| Kept: middle half, BNB per unit of weight | 0.0388 to 0.0729 | 0.0453 / 0.0667 / 0.0950 |
| Kept: lowest | 0.0168 | 0.0168 |

Also open at block 134,724,711: 74 listings for miners that are mining but can't be bought right now, and 5,808 listings for circuits that aren't mining.

## What was decided

William kept the 3× ceiling (20 November 2026). The ceiling drops asks no buyer has come near: the highest rate paid in the 14 days was 2.32× the median. Low asks are never dropped, and Sell states how many asks were left out and why, so the larger share left out is shown, not hidden. Rule 6 is unchanged; this note records the evidence the ADR didn't have.
