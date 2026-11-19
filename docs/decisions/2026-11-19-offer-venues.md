# Offer venues: Sell from the BNB market, Lend from TapePool, Rent shown as having no venue

- **Date:** 19 November 2026
- **Status:** Accepted
- **Decided by:** Furqaan (options a + c in `docs/notes/2026-11-19-xlayer-market-findings.md`)
- **Changes:** `docs/PRODUCT.md` (the four options, the demo story); the `Offer` shape's venues in `docs/data-contract.md`

## Context

The product assumed the X Layer market would supply live Rent, Lend and Sell offers. On 19 November it had 15 RIG vouchers, no asks or offers, no rental venue at all (RigVoucher v2 removed the earnings split), and one lending pool (TapePool, another hackathon entry) holding 0.01 BEM. Ranking Hold against offers that don't exist would make the decision screen empty, or tempt us to invent numbers.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| a | Sell bids from the BNB Chain miner market | That's where the miners and the secondary volume are | Sell lives on BNB, not X Layer; another reader |
| b | Redefine Rent as something that exists | Keeps four live options | Changes one of the four options; risks overstating |
| c | Keep the four options; show a missing venue as missing; partner with TapePool for Lend | Honest, matches "a missing offer is shown as missing, never as zero" | Demo can't show "renting beats selling" with a real offer |
| d | Foreman posts offers itself | Fills the book | Ruled out: Foreman never lends or rents anything itself |

## Decision

**a + c.**

| Option | Venue | Chain |
| --- | --- | --- |
| **Hold** | The valuation (no venue) | BNB |
| **Rent** | **No venue today.** Shown as "no rental market exists yet", never as a zero or an estimate | — |
| **Lend** | TapePool (third party), once its pool has liquidity; partner outreach | X Layer |
| **Sell** | Bids on the BNB Chain miner market; RIG voucher asks and offers on X Layer when they exist | BNB, X Layer |

- The four options stay as they are. Rent stays on the screen as an option with no venue, so owners see what's missing rather than a list that quietly shrank.
- **Demo story step 2** becomes "the decision screen compares holding, borrowing against output and selling, with the live offers side by side", instead of "renting beats selling".
- The autopilot's actions on X Layer narrow to **Lend** (TapePool) until a rental venue exists. An agent key still never sells (`2026-11-19-data-contract.md`).

## Consequences

- **`Offer` venues** become `"bnb-market"`, `"xlayer-market"` and `"tapepool"`. A Sell offer's `readAt` can be on chain 56 or 196. The shape is still provisional until the BNB market is read.
- **A rental with no venue** is `{ option: "rent", state: "none", reason: "no-venue" }`, so the screen can tell "no venue exists" apart from "a venue with no offer right now". This is a contract change, made when `Offer` is built.
- Partner outreach to TapePool (liquidity by 2 December, referral fee) moves up in the build order.
- If the BNB market has no live bids either, Sell shows "no offer" with the last sale prices as context (labelled as past sales, never as a bid). That needs its own decision when it comes up.
