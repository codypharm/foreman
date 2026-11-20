# Growth rates: how low, base and high network growth are taken from history

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, one question at a time with a recommended answer (every recommendation was taken)
- **Settles:** the open item in `2026-11-18-valuation-model.md`: "How 'fastest' and 'slowest' growth are taken from history (window length, percentiles)". Its decision 2 stands: low, base and high differ only in network growth, a fixed share a day, compounding
- **Evidence:** the verified network weight sampled daily at 00:00 UTC from 22 August to 20 November 2026 (91 samples, `packages/chain-bnb/scripts/backfill-history.ts`, archive node)

## What the history showed

| Period | Verified network weight growth a day |
| --- | --- |
| Launch week (22 to 29 Aug) | +16.8% (400,529 → 1,189,292) |
| September | +0.4% to +1.8% a week at a time, in bursts |
| October to 20 November | +0.01% to +0.25% |
| Compounded over the last 7 / 14 / 30 / 60 days | +0.053% / +0.120% / +0.068% / +0.139% |
| 7-day stretches over all 91 days | slowest +0.008%, median +0.187%, fastest +16.8% |
| 7-day stretches within the last 30 days | slowest +0.008%, fastest +0.187% |
| Single days, last 21 days | +0.00% to +1.13%; most under +0.05% |

Growth comes in jumps: one day in three weeks added 1.13%, the rest almost nothing. The rate matters little over 30 days and a great deal until the 2030 halving, about 1,365 days away: +0.19% a day grows the network about 13×, +0.068% about 2.5×, +0.008% about 1.1×.

## Decision

1. **Low and high come from the last 30 days.** *Rejected:* all history, whose fastest week is the launch week (+16.8% a day). The network was empty then and that can't repeat; as the low case it takes a miner's share to almost nothing within weeks. *Rejected:* the last 60 days. That takes in September's bursts from an early market that has since slowed.
2. **Fastest and slowest are the fastest and slowest 7-day stretch within those 30 days**, each compounded over its 7 days. Low uses the fastest, high the slowest. A week that contains a jump counts, but one jump day isn't taken as growth that repeats every day. *Rejected:* single days, where the fastest (+1.13%) carried to 2030 would grow the network about 5,000-fold. *Rejected:* 14-day stretches, of which only a few fit in 30 days, so the range would sit close to the average.
3. **Base is the growth compounded over the same 30 days.** It counts the jumps as often as they happened, and it always lies between the slowest and fastest stretch. *Rejected:* the last 14 days and the last 7 days, which swing when a single jump day enters or leaves the window.
4. **Daily samples at 00:00 UTC, kept in the index.** The follow reads one sample a day. The 30 days end at the last midnight before the read, so every valuation on the same day uses the same rates. The screen names the dates ("21 Oct to 20 Nov") and each rate's `Sourced` basis names them too, so anyone can recompute them. *Rejected:* samples ending at the read block itself: about 800 archive reads per valuation, and rates that change by the hour for no real reason.
5. **The high case never assumes the network shrinks.** A negative slowest stretch is used as 0% a day, and the screen states both ("slowest 7 days: −0.2% a day; the high case assumes no growth"). Low and base use what was measured, even if negative. *Rejected:* using a shrinking rate as measured. A few quiet weeks carried to 2030 would multiply a miner's share many times over. *Rejected:* flooring every case at 0, which would hide a network that really is shrinking.
6. **Verified weight only.** The rates come from the verified network weight, the pool the projection values. Rates are rounded up to whole parts per million, so a value errs low, as decision 2 of the valuation model requires.
7. **No 30 days of samples, no rates.** If the index lacks any daily sample in the 30 days, there is no valuation and no payback, and the reason is stated. A rate is never guessed and never filled in.

## Today's rates (30 days to 20 November 2026)

Samples from block 128,838,305 (21 Oct, weight 1,581,408) to block 134,595,494 (20 Nov, weight 1,614,135); 24 stretches of 7 days.

| Case | Growth a day | Parts per million | From |
| --- | --- | --- | --- |
| Low | +0.187% | 1,873 | Fastest 7 days, from 7 Nov |
| Base | +0.068% | 684 | Compounded over the 30 days |
| High | +0.008% | 82 | Slowest 7 days, from 23 Oct |

A miner of weight 140 in that network (from 20 November 00:00 UTC, no design bonus):

| Window | Low | Base | High |
| --- | --- | --- | --- |
| 30 days | 18.1 BEM | 18.4 BEM | 18.5 BEM |
| Until the 2030 halving | 305.1 BEM | 549.4 BEM | 799.9 BEM |

## Consequences

- **`packages/index`:** a daily network sample table, filled from the history and kept by the follow (one `NetworkState` at the first block at or after each 00:00 UTC).
- **`packages/valuation`:** the rule, test first: the stretches, the base, the floor at 0 for the high case, rounding up, and refusing a window with a missing day. Then the `Valuation` built from `Miner`, `NetworkState` and these rates, each rate a `Sourced` assumption whose basis names the dates and the stretch.
- **Not yet backtested.** The model stays `backtest: "pending"`. The backtest measures how often actual output fell inside the range, and these choices are revisited against it, in a new ADR. Until then the forecast is never called accurate.
- **One jump in the window changes the low case.** The 7 November stretch holds the 12 November jump (+1.13%). When it leaves the window, the low case's rate will fall. The screen shows the dates, so this is visible, not hidden.
