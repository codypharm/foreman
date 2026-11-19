# For William: what changed on 19 November

*From Furqaan. Your eleven questions are answered in `docs/decisions/2026-11-19-data-contract.md`. Since then, the X Layer and BNB markets turned out very different from what the mocks assumed, and three more decisions followed. This is what they change for your pages, the demo and your code, most urgent first.*

## Summary

| # | What changed | What it means for you | Decision |
| --- | --- | --- | --- |
| 1 | **No rental market exists**, on either chain | Rent shows "no rental market yet", never a number | `2026-11-19-offer-venues.md` |
| 2 | **No bids for miners exist**, on either chain | Sell shows "no bid right now", then labelled sales and asks of comparable miners, then a listing the owner signs | `2026-11-19-sell-without-bids.md` |
| 3 | **Lend is TapePool** (another hackathon team, X Layer), currently 0.01 BEM of liquidity | Lend is usually "none" until they have liquidity | `2026-11-19-offer-venues.md` |
| 4 | **Demo step 2** is now "compare holding, borrowing against output and selling" | The "renting beats selling" beat is gone | `docs/PRODUCT.md` |
| 5 | **An agent key never sells** (from the earlier answers) | Demo step 7 needs a different refused move | `2026-11-19-data-contract.md` |
| 6 | **`Offer` is settled**, with currencies | Code the decision screen against it | `2026-11-19-offer-shape.md` |

## 1–3. The decision screen needs a new mock

Under "mock first, William chooses", this is a layout change after the choice, so it's a new mock and a new choice for you. What the screen has to show now:

| Option | Shows |
| --- | --- |
| **Hold** | Unchanged: the valuation range |
| **Rent** | "No rental market yet". It stays on the screen so owners see what's missing |
| **Lend** | TapePool's advance (BEM now, fee, 7 or 14 days, repaid from output), or "no offer". Read on X Layer |
| **Sell** | Headline "No bid right now". Then **recent sales** of comparable miners (BNB per unit of weight, with dates), the **asking range** of similar listings (with how many listings it comes from), each list's **rule** in words, and a **List for sale** button the owner signs |

The market numbers behind Sell (read today, 19 Nov):
- TapeOut's circuit market on BNB has 91 open asks for mining miners, from 23 sellers. Asking prices have a median of 0.2 BNB, with junk up to 888 BNB, which is why the asks are filtered and the filter is stated.
- It has no bids, and OwlGate's off-chain offer book is empty.
- Sales are thin: about 3 every 7.5 hours.

**Prices are in BNB, not BEM** (the X Layer market is in OKB). To put Sell next to Hold in BEM, the screen converts at today's prices and says so, the same as the USD figure. See "Gaps" below for the price this needs.

**Rules screen mock:** "Rule 2 · Only rent for 30 days or less" and its live-offer examples can't be shown, because there are no rental offers to draw examples from. Lend rules ("Borrow at most 25 BEM") can.

**Agent key mock:** allowed options are **Lend only** for now. Rent has no venue, and selling is never allowed.

## 4–5. Demo story

- **Step 2:** "the decision screen compares holding, borrowing against output and selling, with the live offers side by side".
- **Step 7:** the refused move can't be "selling below the floor", because a key can never sell. Use a move the rules circuit refuses, for example a TapePool advance above the owner's borrowing limit.

## 6. Code you can use now

All on `main`, tests passing:

| Package | What you get |
| --- | --- |
| `@foreman/contract` | Types and parsers for `Miner`, `NetworkState`, `Valuation`, `Price`, `Offer`, `Sourced`. Parse everything that crosses the API; a parse failure is an error, never a zero. README: `packages/contract/README.md` |
| `@foreman/chain-bnb` | `readMiner`, `readNetworkState` (pass both the same `blockNumber`), `readNetworkHistory`, and the circuit market (`readActiveListings`, `readSales`). README: `packages/chain-bnb/README.md` |

Two contract details for the valuation and the miner page:
- **Growth may be negative** (the network can shrink). The low case has the *fastest* growth, so growth is ordered low ≥ base ≥ high.
- **A miner that isn't active has weight 0 and no bonus.** The contract zeroes a stopped miner's weights.

## Gaps I'm working on

- **Network history since 21 Aug** needs an archive RPC key (I'm getting one). Until then, growth rates stay assumptions, and the valuation should keep saying so.
- **Prices for conversion:** `Price` is USD per BEM only. Comparing a BNB sale with Hold in BEM needs BNB (and OKB) prices too. I'll extend `Price` with a currency. Price feeds are yours (API job), so tell me if you'd rather shape it.
- **TapePool:** I'll ask them about liquidity by 2 December and a referral fee.
- **The comparables rule** (which miners count as comparable, and the ask filter) runs in option ranking, which is yours. I'd start with "same processor, weight within ±50%, last 30 days; asks above 10× the median sale per weight left out", then tune it with the backtest. It has to be code, and it has to be stated on screen.

The research behind all this is in `docs/notes/2026-11-19-xlayer-market-findings.md`.
