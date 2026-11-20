# Scope and team: Foreman becomes "know what you're buying", built by William alone

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Supersedes:** the autopilot scope in `docs/PRODUCT.md` (18 Nov); the team and lanes in `CLAUDE.md`
- **Narrows:** `2026-11-19-offer-venues.md` and `2026-11-19-sell-without-bids.md` (still in force for what Hold, Rent, Lend and Sell show; their autopilot consequences no longer apply)
- **Withdraws from the data contract:** `Policy`, `TapeOutResult`, `AgentKey`, `ActionLogEntry` (see `docs/data-contract.md`)

## Context

1. **Furqaan left the project on 20 November.** William is now the only builder and the lead. Furqaan's code on `main` (`packages/contract`, `packages/chain-bnb`, the archive backfill) stays and is reused, credited to him in the README.
2. **The markets autopilot was meant to route into don't exist.** No rental venue, no bids for miners on either chain, and TapePool holding 0.01 BEM (`docs/notes/2026-11-19-xlayer-market-findings.md`). An agent key that can't sell, with Rent having no venue and Lend no liquidity, has nothing to do.
3. **The BNB market is real but small.** A 7-day read of TapeOut's circuit market on 19 November (block 134,530,545, archive node): 167 listings of active miners by 19 sellers, 68 sales (about 10 a day, 31 BNB), 9 distinct buyers with the top one making 51% of purchases. Sales happen at the ask. Buy and sell tools alone would serve a few dozen people, and listing and bidding already exist (TapeOut's market, OwlGate).
4. **Copies and wrappers are a problem the community wrote down.** TAPs issue #102: anyone can tape out a byte-for-byte copy of a circuit, or a netlist made only of REF records that points to another circuit at zero transistor cost; on 25 October two collections held up to about 1,400 toy circuits and hundreds of pure-REF wrappers, and some markets list them as compliant. The OCCC proposal (#102/#103, `gm-lsp/Tapeout-OCCC`, two commits from 4 November) certifies **new** curated collections only. Nobody checks existing circuits.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| A | Keep the autopilot scope | Already designed | Nothing for it to act on; two-person workload |
| B | Buy and sell tools only (valuation, comparables, rule-based bids) | Uses the real market | Serves about 20 sellers and 9 buyers; listing and bidding already exist |
| **C** | **"Know what you're buying": originality, value and options for any miner, published on X Layer** | Community-raised problem nobody has solved for existing circuits; reuses the valuation and market work; clear X Layer piece | Originality alone is simple to detect, so the value comes from combining it with valuation and publishing it |
| D | Switch to another idea from the shortlist | Fresh start | Loses two days of work and the chain readers' head start |

## Decision

**C.** For any miner or RIG voucher, Foreman answers three questions:

1. **Is it original?** Exact copies (byte-identical netlist; the earliest tape-out is the original) and wrappers (REF-only netlists, with the circuit they point to). OCCC status shown where a circuit is in an OCCC collection.
2. **What's it worth?** The valuation range and payback, from chain data.
3. **What can I do with it?** Hold, Sell (recent sales and asks of comparable miners), Lend (TapePool's offer or "no offer"), Rent ("no market yet").

Results are **published on X Layer** so markets and lenders can read them on chain. One alert: **"a copy of your miner was just listed"**.

**Cut:** autopilot, agent keys, rules circuits, AI rules drafting, paper runs, auto-bids, the Telegram bot, Chinese language and the strategy marketplace. Autopilot is a possible later step if real markets appear on X Layer.

## Two corrections to earlier proposals

- **No "the two circuits behave the same" check.** Every correct solution to the same mining task behaves the same, so a functional comparison would flag honest independent designs as copies. Issue #102's two cases don't need it: a copy is byte-identical, and a wrapper says what it points to.
- **No invented copy discount.** A miner's value comes from its own on-chain weight, copy or not. A wrapper that burned no transistors will show the weight the mining contract gives it. Originality is shown beside the value, never folded into it as a guessed percentage.

## Consequences

- `docs/PRODUCT.md` is rewritten for this scope and a one-person build order.
- `CLAUDE.md`: William is the sole owner and lead; lanes are removed; the trust rules, domain words and required tests change to originality and publishing.
- `docs/data-contract.md`: `Originality` and `PublishedResult` are added (provisional); the four autopilot shapes are withdrawn. Their parsers in `packages/contract` are removed in a later commit, not silently.
- New "Still open" items, most urgent first: where netlists are stored on chain and the REF record format (TAP-02 §4, §6); whether REF-only wrappers can mine; how to index every circuit since launch; the X Layer results contract and who holds its publisher key.
