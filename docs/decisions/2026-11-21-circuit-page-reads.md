# The result page: one read block, and unverified miners

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-api-endpoints.md` (decision 3: values computed on request)
- **Changes:**
  - decision 3 of that record: "cached for a minute" becomes "read at the market index's block";
  - the data contract's `CircuitPage`, `ListingRow` and `Payback`, which gain a "not valued" state.

## Context

The result page combines rules that each need their inputs from one block:

- the value needs the miner and the network;
- payback needs the miner, the network, the listing and the BEM price;
- the Sell rule needs the miner at the market index's block.

The valuation engine also refuses miners in the unverified pool (task 0, 1% of emission): "the projection doesn't value yet". But the approved shapes require a value for every active miner. On 21 Nov 2026, 50 of the 6,182 open listings were active unverified miners.

## Decision

Settled by a grilling on 21 Nov 2026.

1. **The page reads BNB Chain at the market index's block.** The miner, the network and the BEM price are read on request from the archive node at the block the market follow reached. That block is at most about five minutes old, the follow's pace. The stored listing and the Sell comparables are from the same block, so every part of the page is one moment, and the page states that block. X Layer (the RIG voucher and Lend) is read at its latest block, which each Lend offer states.
2. **An active miner in the unverified pool is "not valued yet".** Hold, the listing row's 30-day value and payback each get a `not-valued` state with its reason: "Foreman doesn't value the unverified pool yet". It is never a made-up number and never "not mining". The mining set on the listings page still counts these miners.

## What follows

- **The data contract changes.** `CircuitPage.hold`, `ListingRow.value30d` and `Payback` gain `{ state: "not-valued"; reason }`, allowed only for an active miner in the unverified pool.
- **Revisit** when the unverified pool is modelled: weight ÷ unverified network weight × emission × 1%, with its own growth rates.
