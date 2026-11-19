# Foreman: product

*Source of truth for what we build. The trust rules and domain words are in `CLAUDE.md`; the full research brief is the [Google Doc](https://docs.google.com/document/d/1PA3ftj2tFWzcKyj02hxZelqzRayx-DF3gd0w3vSYUjM/edit). Written 18 November 2026. Furqaan signs changes to scope.*

## The problem

A TapeOut miner is a circuit NFT that earns BEM every day under Proof of Design. Mining runs on BNB Chain, and since October the same miner can be sold, rented out or used as collateral on X Layer. That turned miners into income assets, but owners still decide by hand:

- **What is it worth?** Output depends on the miner's share of network weight, which shrinks as new miners join, and on the BEM price, which swings hard (about $20 to a $101.9 peak and back down within days in September).
- **What should I do with it?** Hold, rent, borrow against it or sell. Each option lives on a different contract with different terms, and the best one changes week to week.
- **Who is watching?** Nobody. An owner who doesn't check rates every day leaves BEM on the table.

The tools that exist answer narrower questions. TapeOutScan and Likely2X show statistics, not a value or a decision. TapePool lends against 7 or 14 days of output and shows only its own offer.

## What Foreman is

An AI manager for TapeOut miners. It values each miner as a range, compares **Hold, Rent, Lend and Sell** with live offers, and can run the miner on **autopilot** within rules the owner writes in plain English. The rules become a TapeOut circuit, and the owner's wallet checks every autopilot action against it on chain.

**Foreman never holds a miner and never lends or rents anything itself.** It routes the miner to whoever pays best and earns a fee for doing so.

**Pitch line:** full autopilot for your miner. It never leaves your wallet, and your rules are enforced on chain.

## Users

| User | What they want | What they get | Pays? |
| --- | --- | --- | --- |
| **Owner** (primary) | Earn the most from their miners without watching rates | Estimated value, the four options ranked, autopilot within their rules | Autopilot fee on earnings above holding; premium for several miners |
| **Buyer** | Know if a listed miner is fairly priced and when it pays back | Estimated value, payback range, alerts on listings under value | Free; premium alerts |
| **Lenders and markets** (TapePool, the X Layer market, TapeSurge) | Customers, and a second opinion on value | Owners routed to their offers; price feed and API | Referral fees; API |

## How it works: the pipeline

| Step | What happens | Where it runs |
| --- | --- | --- |
| 1. **Read** | Per-miner claim events, weight and status from the BNB mining contract; network weight and emission; X Layer offers | Chain readers |
| 2. **Value** | Expected output = weight ÷ network weight × emission × 99%, under low / base / high scenarios for network growth and BEM price, with halving. Backtested against real claims | Valuation engine |
| 3. **Compare** | Hold, Rent, Lend and Sell ranked on the same inputs, with what each pays over 30 days and until the 2030 halving | Option ranking |
| 4. **Draft rules** | The owner types rules in plain English. AI turns them into a policy and shows it back in plain words, with examples of what would be allowed and refused. The owner confirms | AI rules drafting |
| 5. **Compile** | The confirmed policy becomes a NAND netlist, is tested on every input (small widths) or a fixed set, and is taped out as the owner's rules circuit | Rules compiler |
| 6. **Paper run** | The strategy replays on history, then runs live for a period without real moves | Paper runs |
| 7. **Act** | The agent proposes the best allowed move. The owner wallet calls eval() on the rules circuit; only a yes executes. Without autopilot, the owner signs each move with one tap | Agent loop, owner wallet module |
| 8. **Explain** | Every move, its reason and what the alternative paid go to the action log, the app and Telegram | Action log, bot |

## The four options

| Option | Shown as |
| --- | --- |
| **Hold** | Expected BEM over 30 days and until the 2030 halving, as a range |
| **Rent** | Best live rental offer, and what it is worth against holding. **No rental venue exists today** (`docs/decisions/2026-11-19-offer-venues.md`): shown as "no rental market yet" |
| **Lend** | Best live TapePool terms (X Layer): BEM received now, how long repayment takes |
| **Sell** | Best live bid against the estimated value range: the BNB Chain miner market, and RIG voucher offers on X Layer when there are any |

A missing offer is shown as missing, never as zero. A missing venue is shown as missing too.

## MVP scope

**In:**

- Paste a miner key or connect a wallet: estimated value range with its inputs, payback for a given price.
- Decision screen with live offers; one-tap actions the owner signs.
- Rules in plain English → confirmed policy → taped-out rules circuit.
- Owner wallet module with agent keys (allowed actions, daily limit, expiry, one-tap revoke), testnet first.
- Paper runs.
- Autopilot on X Layer mainnet with low limits.
- Action log in the app.
- Backtest results published in the README.

**Stretch (in this order):** Telegram bot · Chinese language · strategy marketplace · buyer alerts · price feed and API · bridge-and-earn flow for miners still on BNB Chain.

**Out:** holding miners, lending or renting ourselves, our own bridge, selling without the owner turning it on, any number that comes from a model call.

## Owners

Furqaan leads: he owns the data contract, the trust rules and the final go/no-go, and reviews every merge.

| Area | Owner |
| --- | --- |
| Chain readers: BNB mining events and current state; X Layer market, rentals, TapePool | Furqaan |
| Rules compiler: policy → NAND netlist, tests, tape-out | Furqaan |
| Owner wallet module: agent keys, eval() guard, limits, revoke | Furqaan |
| AI rules drafting: plain English → policy, the confirmation examples | Furqaan |
| Agent loop: choosing the best allowed move and explaining it | Furqaan |
| Data contract, contract addresses, submission form | Furqaan |
| Valuation engine and backtests | William |
| Option ranking and offer display | William |
| Paper runs | William |
| API and jobs | William |
| Web app: miner page, decision screen, rules screens, action log, OKX Wallet, DeWEB mirror | William |
| Telegram bot, Chinese language, strategy marketplace UI (stretch) | William |
| Demo video, README, pitch | William |
| Telegram outreach: partners (TapePool, market, TapeSurge), early users | Both |

## Build order

Build so each step works end to end before the next. Dates are proposed; Furqaan confirms.

| When | Furqaan | William |
| --- | --- | --- |
| 18–19 Nov | Read the mining contract's functions on BscScan; find X Layer RIG, rental and TapePool addresses; check whether a smart wallet can hold a bridged miner; draft the data contract | Ask in Telegram: does anyone price miners, do copied miners earn, will partners pay referrals; propose stack options for the ADRs |
| 20–23 Nov | BNB reader: per-miner claim history and current state; X Layer offer reader | Repo scaffold (after stack ADRs); mocks of every MVP page with the `impeccable` skill, 2–3 directions each, and choose; valuation engine on saved fixtures, with backtests; API skeleton |
| 24–27 Nov | Policy schema, compiler to netlist, exhaustive eval tests; AI rules drafting | Miner page and decision screen; option ranking; wallet connect; one-tap actions (owner signs) |
| 28 Nov–1 Dec | Owner wallet module on testnet; agent loop | Paper runs; rules confirmation screens; action log |
| 2–3 Dec | **Integration:** autopilot end to end on testnet, then mainnet with low limits (a human signs) | **Integration:** the full demo story works; stretch items if green |
| 4 Dec | Real users and deals; partner quote | Demo rehearsal; README with backtests |
| **5 Dec** | **Feature freeze** | Demo video |
| 6 Dec | Submit, a day before the provisional deadline | Submit |

**Cut list, in this order, if behind on 1 December:** price feed and API → strategy marketplace → Chinese → Telegram bot → autopilot on mainnet (keep it on testnet for the demo).

**Never cut:** value ranges with their inputs, the rules circuit check on every autopilot action, one-tap revoke, and the decision screen.

## Demo story (three minutes)

1. Paste a real miner. Its estimated value range appears, with the inputs that produced it.
2. The decision screen compares holding, borrowing against output and selling, with the live offers side by side (`docs/decisions/2026-11-19-offer-venues.md`).
3. The owner types one sentence of rules. Foreman shows them back in plain words, with "allowed" and "refused" examples. The owner confirms.
4. The rules circuit is taped out; its address is on screen.
5. The paper run shows what the strategy would have earned.
6. The owner issues an agent key. The agent makes its first move on X Layer and explains it.
7. A move that breaks the rules (selling below the floor) is attempted and refused on chain.
8. One tap revokes the key.

## Still open

Mirrors "Still open" in `CLAUDE.md`. Strike an item when an ADR settles it.

- ~~Mining contract read functions: weight, status, pending rewards.~~ Settled: `docs/decisions/2026-11-19-data-contract.md`.
- X Layer RIG, rental and TapePool addresses, and weekly volume.
- Can a smart wallet hold a bridged miner and still rent or lend it?
- Gate count of a realistic rules circuit.
- Do copied or wrapper circuits earn?
- Will partners pay referral fees?
- Does anyone already publish fair values?
- Tech stack, repository layout, fee token, AI model.
