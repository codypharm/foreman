# Offer shape: per-option offers, currencies, and Sell with sales and asks

- **Date:** 19 November 2026
- **Status:** Accepted
- **Decided by:** Furqaan
- **Replaces:** the provisional `Offer` in `2026-11-19-data-contract.md` (decision 6)
- **Follows:** `2026-11-19-offer-venues.md`, `2026-11-19-sell-without-bids.md`
- **Code:** `packages/contract/src/offer.ts`

## Context

The provisional `Offer` assumed live Rent, Lend and Sell offers on X Layer, priced in BEM. The readers found that no rental venue exists, that Lend is TapePool, that Sell has no bids anywhere, and that miner prices are in BNB (BNB market) or OKB (X Layer market).

## Decision

- **Each option has its own shape**, and a missing offer is its own state, never an amount of zero:
  - **Rent** is `no-venue` (no rental market exists) or `none` (a venue with no offer now, kept for when one appears). **There is no live Rent shape** until a venue exists to read one from.
  - **Lend** is a live TapePool advance (BEM received now, the fee, a 7- or 14-day term, repaid from output) or `none`.
  - **Sell** is a **bid** (`live` or `none`) plus **sales** and **asks** of comparable miners. Each list carries the **rule** that picked it, in words for the screen.
- **Every amount names its currency:** BNB and OKB in 18-decimal base units, BEM in 8. An amount on its own is never assumed to be BEM.
- **Each venue lives on one chain:** the BNB market on 56, the X Layer market and TapePool on 196. A read from the wrong chain is refused.
- **Comparables carry the comparable miner's weight** (never 0), so the screen can show price per unit of weight. Sales carry their transaction; asks don't.
- **Who fills it:** the readers supply listings, sales and miner weights. The code that picks comparables and applies the ask filter runs in option ranking and states its rule. The exact rule is settled with the backtest, never by a model.

## Consequences

- `docs/data-contract.md` "Offer" is rewritten and no longer provisional.
- Hold remains the `Valuation`, not an offer.
- **Converting** a BNB or OKB price to BEM for the comparison uses today's prices and says so on screen (`2026-11-18-valuation-model.md`). That happens at display time, never inside an `Offer`.
- **A live Rent shape** is added by a new ADR when a rental venue exists.
