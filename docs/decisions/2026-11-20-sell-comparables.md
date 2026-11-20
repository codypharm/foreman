# Sell comparables: which sales and asks, and the range they give

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, one question at a time with a recommended answer (every recommendation was taken)
- **Narrows:** `2026-11-19-sell-without-bids.md`, which left "comparable" and the ask filter to be settled; its example rule (same processor, weight within ±50%, last 30 days, asks over 10× the median) is replaced by the rule below
- **Changes:** `Comparables` in `docs/data-contract.md` gains `pool`, `range` and `leftOut`
- **Evidence:** every `Sold` event on TapeOut's circuit market in blocks 132,025,299 to 134,713,299 (7 to 20 November 2026), each sold miner's `getMiner` at the block before its sale, and its verdict from the index

## Context

There is no bid for a miner, so Sell shows completed sales and open asks of comparable miners (`2026-11-19-sell-without-bids.md`). What counts as comparable, how far back, how junk asks are dropped, and how the sales become a range were open. The trust rules apply: the rule is code, stated on screen; ranges, not prices; missing is missing.

## What the market showed

425 sales in 14 days. 145 were miners that were mining at the block before the sale; 280 were circuits that weren't, and those sold flat at about 0.04 BNB whatever the circuit.

Among the 145, the price ran from 0.02 to 48 BNB, because weight ran from 1 to 1,204. **BNB per unit of weight barely moved:**

| Group | Sales | Median BNB per unit of weight |
| --- | --- | --- |
| Verified, all | 140 | 0.0358 (middle half 0.0336 to 0.0396; lowest 0.024, highest 0.0833) |
| Processor `0xb102…` (multiplier 1) | 141 | 0.0357 |
| Processor `0x1f5c…` (multiplier 6) | 4 | 0.0395 |
| Busiest tasks (4, 74, 220, 100) | 17 to 58 each | 0.032 to 0.037 |
| Weight 1 to 9 / 10 to 99 | 94 / 47 | 0.0350 / 0.0365 |
| Last 3 / 7 / 14 days | 40 / 61 / 145 | 0.0350 / 0.0344 / 0.0358 |
| Without the largest buyer (66% of purchases) | 50 | 0.0344 |
| Copies / no earlier copy found | 50 / 3 | 0.038 / about 0.03 |
| **Unverified (task 0, the 1% pool)** | **5** | **0.020** |

142 of the 145 were copies or too small to tell.

**Open asks at block 134,713,299:** 569, of which 101 were for miners that were mining (95 verified from 24 sellers, 6 unverified). Against the 3× ceiling in rule 6 (0.1076), 5 verified asks are left out (0.122, 0.2, 0.333, 80.7 and 222 BNB per unit of weight) and 90 are kept: middle half 0.0388 to 0.0729, lowest 0.0168, highest 0.1.

## Decision

1. **Comparable sales are sales of miners that were mining**, in the same pool as this miner, compared as **BNB per unit of weight**. "Mining" is status active in `getMiner` at the block before the sale; weight is that read's verified weight (`verifWeight`) for a verified miner, its unverified weight (`unverWeight`) for an unverified one. Processor, task and size are not filters: the rate is the same across them and filtering would only cut the count. Circuits that weren't mining are not comparable.
2. **The window is the last 14 days**, by block time, ending at the block the Sell context is read at. The screen states the count and the date span.
3. **Verified and unverified pools are kept apart.** A verified miner compares only with verified sales, an unverified miner only with unverified sales. A unit of weight earns differently in each pool, and the market prices them about 2 to 1.
4. **The range is the middle half, times this miner's weight.** Low = the 25th percentile rate, mid = the median, high = the 75th percentile, each × this miner's weight (the same field as in rule 1, read at the Sell context's block). Percentiles by linear interpolation between the sorted rates (position (n − 1) × p), kept exact and rounded down to whole wei only at the end. Every sale is still listed under the range with its date, price and weight. The screen says "middle half of N sales". Today a verified miner of weight 10: 0.336 / 0.358 / 0.396 BNB.
5. **At least 10 sales before a range is shown.** Below 10, the sales are listed one by one with no range, and the screen says how many there are. Today the unverified pool, with 5 sales, has no range.
6. **Junk asks: an ask counts when it can be bought right now (`2026-11-20-market-index.md`, rule 7), its miner is mining, in the same pool, and its BNB per unit of weight is no more than 3 × the median sale rate** (same pool, same 14 days). Today that ceiling is 0.1076. The highest rate anyone actually paid in the 14 days was 2.32 × the median, so 3× keeps every price paid and drops asks no buyer has come near. Low asks are never dropped: a cheap ask is a competing seller. The screen states how many were left out ("N asks left out: over 3× the median sale"). With fewer than 10 sales there is no median to measure against: asks are listed one by one, with no range and nothing left out, and the screen says why ("No asking range: only N sales to measure asks against"), however many asks there are. The asks that are kept get their range by rules 4 and 5.
7. **Copies and wrappers change nothing here.** A copy miner gets the same range from its own weight; its originality verdict is shown beside Sell, never folded in (the trust rule "no invented copy discount"; the market shows no discount either). Sales are not filtered by verdict. A miner that isn't mining (a wrapper can't mine; a stopped or not-started circuit has no weight earning) gets no range: "Not mining: no comparable sales".
8. **The range is carried in the data contract,** computed and tested once in `packages/valuation`, never on screen (the alternative, the web app working out percentiles from `items`, would put the rule outside the tested core).

## Consequences

- `docs/data-contract.md`: `Comparables` gains `pool`, `range` (shown, or why not) and `leftOut`. Asks have a reason of their own for no range, "too few sales" (William, a follow-up question while building: fewer than 10 sales can come with any number of asks, so "too few asks" can't say it).
- `packages/valuation`: the comparables rule, tested under "Sell comparables" in `CLAUDE.md`: the stated rule picks the sales; an ask over the ceiling is left out and counted; a low ask is kept; under 10 sales gives no range; the pools never mix; a sale of a miner that wasn't mining is never comparable; no bid stays "no bid right now".
- Rule 1 needs `getMiner` at the block before each sale: one archive read per sale, about 10 a day. Cache by block.
- The rule string on screen, today: "Mining miners in the verified pool, last 14 days, BNB per unit of weight; range = middle half × this miner's weight; asks over 3× the median sale left out."
- The numbers above are a snapshot of a small, young market with one buyer making two thirds of the purchases. The rule is recomputed on every read; the 3× ceiling and the minimum of 10 are reviewed if the market changes shape.
