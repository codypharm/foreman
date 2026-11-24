# The high case assumes no network growth

- **Date:** 24 November 2026
- **Status:** Accepted
- **Decided by:** William, choosing from three rules, each with its backtest result
- **Supersedes:** decision 2 of `2026-11-20-growth-rates.md` for the high case only ("high the slowest" 7-day stretch). Low stays the fastest 7-day stretch and base the 30 days compounded
- **Follows:** decision 6 of `2026-11-24-forecast-backtest.md`: the range held in fewer than 2 of 3 windows, so William was given rule options
- **Model version:** `2026-11-24` (was `2026-11-20`)

## What the backtest showed

The 30-day range under the `2026-11-20` rules, against the output a verified miner of unchanged weight actually earned, for every start date from 21 September to 24 October 2026 (34 start dates; neighbours share most of their 30 days):

| | Result |
| --- | --- |
| Held (low ≤ actual ≤ high) | 13 of 34 |
| Below low | 0 |
| Above high | 21 |
| Base error, median / worst | 7.1% / 41.0%, base below actual every time |

The network's growth slowed steadily, from about 2.5% a day in mid-September to about 0.01% a day by late October. Every month was slower than the slowest week of the month before, so the high case (the slowest week) kept falling short. Every miss was on the cautious side: miners earned more than the high case, never less than low.

## The options William was shown

The same backtest, changing only the high case:

| Rule for high | Held | Typical width (high − low, as a share of base) |
| --- | --- | --- |
| A. The slowest 7 days of the last 30, never below 0 (the `2026-11-20` rule) | 13 of 34 | 23% |
| **B. No growth: the network stays at today's weight** | **34 of 34** | **25%** |
| C. The slowest single day of the last 30, never below 0 | 34 of 34 | 25% |

## Decision

1. **High assumes the verified network stops growing:** 0 parts per million a day, from the valuation's start. It is stated on screen as an assumption, not as a measured rate.
   *Rejected:* A, which held in 13 of 34. *Rejected:* C, the same result as B with a rule that is harder to state and still depends on one quiet day.
2. **If the network shrank over the 30 days, high uses the same rate as base.** Base is already the measured rate (decision 5 of `2026-11-20-growth-rates.md` keeps it even when negative), and high can never be below base. The basis says the network shrank. This hasn't happened in the 94 days of history; it fixes a case where the `2026-11-20` rules would have refused to value at all (a high case of 0 above a negative base breaks low ≤ base ≤ high).
3. **The same high case for the 30-day and the halving views.** The halving view is not backtested (decision 2 of `2026-11-24-forecast-backtest.md`) and says so.

## What this decision does not settle

- **It was tuned on the history it is tested against.** B was chosen after seeing that A missed on these same 34 start dates. The README and the screen state the backtest result, not a promise. It is rerun before submitting, when about 45 start dates will exist, and the result is shown as it comes out.
- **B would miss if the network shrank,** for example if many miners stopped. That hasn't happened yet.
- **Base still errs low** (7.1% typically, before this change and after it; B changes only high). That is the cautious side, and it is stated beside the range.

## Consequences

- **`packages/valuation`:** `growthRates` returns high = 0 (or base, if base is negative) with a plain basis; `MODEL_VERSION` becomes `2026-11-24`; the backtest result is fixed to that version, with a test that it matches the saved fixture.
- **The web app:** the growth line's high basis reads "no network growth". The model line states the backtest result (mocked first, `2026-11-24-forecast-backtest.md`).
- **Published values carry the new version,** so a value computed under `2026-11-20` can still be recomputed under its own rules.
