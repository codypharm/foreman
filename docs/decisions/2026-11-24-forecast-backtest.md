# The forecast backtest: how often the 30-day range held

- **Date:** 24 November 2026
- **Status:** Accepted
- **Decided by:** William, one question at a time with a recommended answer (every recommendation was taken)
- **Builds on:** `2026-11-18-valuation-model.md`, `2026-11-20-growth-rates.md` (its consequence: "The backtest measures how often actual output fell inside the range, and these choices are revisited against it, in a new ADR")
- **Changes the data contract:** `Valuation.model.backtest` (decision 4)

## Context

Every value on screen says "backtest pending". The payout maths mirrors the mining contract and is tested, but the forecast, the low / base / high range of network growth, has never been checked against what happened. The index holds 94 gap-free daily network samples, at 00:00 UTC from 22 August to 23 November 2026.

## Decisions

1. **"Actual output" is recomputed from the real network.** It is the output a verified miner of unchanged weight earned over the 30 days, from the network's actual verified weight each day (the daily samples), with the same day-by-day accrual as the projection. The range only forecasts network growth, so this tests exactly that, and the answer is the same for every miner of that kind.
   *Rejected:* real miners' `Claimed` events. Claims are paid in lumps at times owners choose, and miners stop or are revoked, so a miss would often be claim timing, not the forecast. It also needs many archive reads.
   **Not tested:** the low case's other assumption, that a miner can lose its design bonus. The backtest's miner holds no bonus.
2. **The 30-day range only.** The "to the 2030 halving" view, about 1,365 days, can't be tested on 94 days of history. That tab says so: "Not backtested: 94 days of history can't test a forecast to 2030."
3. **Every start date with 30 days before and 30 after.** The 30 days before set the rates, exactly as the app does on that date; the 30 days after are the outcome. On 24 Nov 2026 that is every day from 21 September to 24 October: 34 start dates. Neighbouring start dates share most of their 30 days, so they aren't independent tests, and the screen and the README say so.
   *Rejected:* non-overlapping start dates only: 2 today, which say almost nothing.
4. **What is measured and shown:**
   - **Coverage:** how many start dates' actual output fell between low and high, inclusive.
   - **Base error:** how far base was from the actual output, as a share of actual: the median and the worst.
   - **Misses by side:** how many fell below low and how many above high. In the README and the record; the screen shows coverage and base error.

   The data contract's `model.backtest` becomes `"pending"` or the result: the horizon in days, the number of start dates, how many held, the first and last start dates, the base error's median and worst in parts per million, the misses below low and above high, and `ref`, where the full table is. On screen: "Range held in N of 34 past 30-day windows (21 Sep to 24 Oct, overlapping); base off by X% typically, Y% at worst."
5. **Fixed, from saved samples.** A script runs the backtest from a saved fixture of the daily samples. The numbers are stored with the model version, and a test proves they match the fixture (CLAUDE.md, "Tests that are not optional"). Anyone can rerun it and get the same answer. It is rerun by hand before submitting, when there will be about 45 start dates.
   *Rejected:* the worker recomputing it daily: numbers that move without a code change and aren't tied to a fixture anyone can rerun.
6. **The number is shown as it is.** If the range held in fewer than 2 of 3 windows, William gets 2 or 3 rule options with their backtest results. Any change is a new ADR and a new model version, and it states that it was tuned on this same history.
   *Rejected:* keeping today's rules whatever the number says.

## Consequences

- **`packages/valuation`:** the backtest, test first, using the app's own `growthRates` and `outputRange`; the result constant tied to `MODEL_VERSION`.
- **`packages/contract` and `docs/data-contract.md`:** the new `backtest` shape.
- **The web app:** the model line and the halving tab's "not backtested" line. A copy change in an existing line, shown to William before it is built.
- **Until the numbers exist,** the forecast is still never called accurate. After, copy states the coverage and the error, never "accurate".
