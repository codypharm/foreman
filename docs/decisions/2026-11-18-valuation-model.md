# Valuation model: unit, scenarios, weight drops and horizon

- **Date:** 18 November 2026
- **Status:** Accepted. The horizon wording on screen waits for Furqaan (see "Open")
- **Decided by:** William, after a grilling with the agent
- **Code:** `packages/valuation` (`emissionBetween`, `expectedOutput`, `projectedOutput`, `outputRange`)
- **Facts used:** `docs/notes/2026-11-18-mining-contract-findings.md`

## Context

The base formula (a verified miner earns its share of verified weight × 99% of emission) is confirmed by the mining contract's verified source. Four things were not settled: what unit a value is in, what separates low, base and high, how to treat a weight that can drop, and what "over the miner's life" means.

The contract also showed that a miner's weight is not fixed. Verified weight = (base figure + design bonus) × processor factor. The bonus belongs to the current best design for a task on a processor; a better design demotes the holder and its weight falls to base figure × processor factor for good. A challenge with a counterexample can revoke a miner entirely.

## Decisions

### 1. Unit: BEM

Estimated values are in **BEM**. A USD figure is shown beside them at **today's** BEM price, labelled as such.

*Why:* bids, loans and owners' rules are quoted in BEM, so options compare like with like. In BEM the range depends on network growth, which can be measured and backtested. A USD range would also have to forecast the BEM price (about $20 to $101.9 and back within days in September), which cannot be backtested honestly.

*Rejected:* a USD range with BEM price scenarios. The BEM price enters only where an option pays in another token (for example a rental paid in USDT), at today's price, and the screen says so.

### 2. Scenarios: network growth only, compounding

Low, base and high differ only in how fast **network weight** grows. Growth is a **fixed share per day, compounding**. Base uses the recent growth measured from chain history; low and high use the fastest and slowest growth seen. Each scenario's rate is shown next to it.

*Why:* it is the main driver in BEM terms, it is measurable from `Started`, `Stopped`, `Demoted` and `Revoked` events, and compounding is the cautious shape for a young network (it shrinks a miner's share faster over long horizons).

*Rejected:* a fixed amount of new weight per day; a discount rate on future BEM (a second, untestable assumption).

Rounding always errs low: a grown network weight rounds up, and output rounds down once at the end, as a claim does.

### 3. Weight drops

- **Low** assumes the miner loses its design bonus from today, if it holds one: weight = base figure × processor factor, read from `getMiner`.
- **Base** and **high** keep today's weight.
- **Revocation** has no number. It happens only if the design is proven wrong, and is shown as a risk in words.

*Why:* every figure comes from the chain and the low case is the exact weight the contract would switch to, so it can be tested and explained ("if a better design for this task appears, weight drops from 412 to 96").

*Rejected:* estimating the likelihood of demotion from past `Demoted` events: a statistical guess on about three months of data, hard to explain or test.

### 4. Horizons: 30 days, and until the 2030 halving

Values are shown over **30 days** and **until the first halving, 18 August 2030, 21:15:32 UTC**, labelled "until the 2030 halving", never "lifetime". The 30-day figure leads; the longer one is shown as more uncertain. Payback for a buyer is stated against the same horizon.

*Why:* after the halving the rate halves and the network will be unrecognisable; nothing we have can say anything useful that far out, and a projection run to 2118 gave a range of 18 to 1,002 BEM for an average miner, which is no use to an owner. The date is on the official schedule, so owners can check it.

*Cost:* it understates total value, because a miner keeps earning after 2030 at half rate and less. The screen says that output after the halving is not counted.

*Rejected:* a fixed one-year horizon; the full life with a discount rate.

## Consequences

- The engine values verified and unverified miners over any window; the API picks the two windows.
- Growth rates are inputs until the BNB reader supplies network weight history; then base, low and high are derived from it, and the backtest measures how often actual output falls inside the range.
- The Sell option should show that unclaimed rewards move with the NFT (claim first), which the contract states.

## Open

- **Screen wording (Furqaan):** `docs/PRODUCT.md` and `CLAUDE.md` say "over the miner's life". Changing that to "until the 2030 halving" is a scope wording change, which Furqaan signs.
- **How "fastest" and "slowest" growth are taken from history** (window length, percentiles) is settled when the history exists, against the backtest.
