# Payback, and BEM's price in BNB

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, one question at a time with a recommended answer (every recommendation was taken)
- **Settles:** the BNB half of "Price conversion" in `CLAUDE.md`, "Still open". OKB against BEM (RIG vouchers on X Layer) stays open
- **Changes:** `docs/data-contract.md` gains `Payback` and `BemPrice`. `Price` stays as it is, display only

## Context

Payback is the number of days until a buyer's price is earned back (`CLAUDE.md`, "Domain language"). A miner on TapeOut's BNB market is priced in BNB, but it earns BEM. Dividing one by the other needs BEM's value in BNB, and nothing in Foreman supplied it: `Price` is USD per BEM, and the data contract says it is never an input to a valuation. The valuation model (`2026-11-18-valuation-model.md`) keeps estimated values in BEM and lets today's BEM price in only where an option is paid in another token, labelled. Payback is that case.

## What the chain showed

BEM trades on BNB Chain in PancakeSwap pools. Only one BEM/WBNB pool holds real liquidity: the v3 pool with the 1% fee, `0x28b12792f9d81bd529bc5572434e861c9edbbbc2`.

| Read on 20 November 2026 | Value |
| --- | --- |
| BEM / WBNB held (block 134,739,204) | 4,742.38 BEM / 17.81 WBNB. That is less BEM than one day of emission (7,200) |
| Price observations kept | 2,100 |
| Swaps | About 210 in the last 49,000 blocks (about 10 hours) |
| BNB per BEM | Spot 0.01848; 30-minute average 0.01854; 1-hour average 0.01823 |
| Other pools | v2 BEM/WBNB and BEM/USDT and the other v3 fee tiers hold dust. BEM/USDT v3 at 1% (9,647 BEM) and 0.01% (2,764 BEM) are USD pairs, not needed here |

## Decision

1. **BEM's price in BNB comes from the chain:** the PancakeSwap v3 BEM/WBNB 1% pool, read at the same block as the miner, the network and the listing. *Rejected:* an off-chain price feed (OKX, CoinGecko). Nobody could recompute it from chain data, and it adds an outside dependency. *Rejected:* no price at all, showing a break-even BEM price instead. Fully chain-derived, but Payback would stop being a number of days.
2. **The price is the pool's 30-minute time-weighted average** up to that block, read with the pool's own `observe([1800, 0])`. The mean tick is rounded toward negative infinity, as PancakeSwap's and Uniswap's oracle library does. That errs toward a cheaper BEM, so a longer payback. The price is held as BNB wei per whole BEM. *Rejected:* the spot price. The pool is thin, so one trade just before the read could move payback, and a published result would carry the moved figure. *Rejected:* a 24-hour average. It lags a BEM that moved 5× in days in September.
3. **Payback is missing only when the pool can't give a 30-minute average at the block:** no pool, or a history shorter than 30 minutes. There is no depth threshold, because any number would be a guess. Instead the screen shows the price, the block, "30-minute average", and the BEM and WBNB the pool holds, so a thin market is visible.
4. **Counting the days.** The ask is turned into BEM at that price, rounded up. Then, for each case (low / base / high), payback is the first whole day from the read on which the miner's projected BEM reaches it. The projection is the valuation's own (`projectedOutput`), with that case's weight and network growth and the emission schedule. A case that doesn't reach it before the first halving (18 August 2030, 21:15:32 UTC) says "not earned back by the 2030 halving", never a number of days. Low is the longest payback, high the shortest. *Rejected:* the price ÷ today's output. It ignores network growth, so it always looks shorter than it should. *Rejected:* a 30-day yes or no. It hides the difference between 31 days and three years.
5. **Payback is for the miner's own asking price:** its open, buyable listing on TapeOut's BNB market, read from the market index (`2026-11-20-market-index.md`). The listing's price is what the buyer pays; the 1% fee comes out of the seller's side. A miner with no buyable listing gets "Not listed: no asking price". A price the buyer types in can come later. *Rejected:* also showing payback at the comparable sales' range. It mixes two estimates and reads like an offer.
6. **Unclaimed BEM is not counted.** It goes with the NFT only if the seller hasn't claimed it first, and the seller can claim it in one transaction at any time before the sale.
7. **A new `Payback` type in the data contract**, beside `Valuation`. It carries the ask, the `BemPrice` it used, the days for each case, and the same inputs as the valuation it came from. It has three missing states: not listed, no price, not mining. `Price` stays display only. *Rejected:* widening `Price`, which would break its rule that a feed price is never an input. *Rejected:* making payback a field of `Valuation`, which would make every valuation depend on a listing and a pool.

## Consequences

- **`CLAUDE.md`, "On-chain facts":** a row for the pool, confirmed on 20 November 2026 at block 134,739,204. Its `factory()` is `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865`, and that factory's `getPool(BEM, WBNB, 10000)` returns the pool. Its `token0()` is BEM, its `token1()` is `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` (WBNB, 18 decimals), and its `fee()` is 10,000 (1%). Its ERC-1967 implementation slot is empty, so it is not a proxy.
- **`packages/chain-bnb`:** a reader for the 30-minute average and the pool's holdings at one block. Tested on saved responses. A pool that can't answer `observe` for 30 minutes is "no price", never a price of zero.
- **`packages/valuation`:** payback, test first. The tests prove:
  - the ask in BEM;
  - the first day reached in each case;
  - "not earned back by the 2030 halving";
  - low ≥ base ≥ high in days;
  - each missing state.
- **The unverified pool:** the projection covers the verified pool only today, so payback does too. An unverified miner's payback follows its valuation, when that exists.
- **OKB:** a RIG voucher priced in OKB on X Layer gets no payback until OKB against BEM is settled. That stays in "Still open".
- **The pool is thin.** The price is a fact about this pool at this block, not a market-wide price, and the screen says so. If a deeper BEM/BNB pool appears, choosing it is a new ADR.
