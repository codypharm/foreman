# Foreman: product

*Source of truth for what we build. The trust rules and domain words are in `CLAUDE.md`. Rewritten 20 November 2026 for the scope in `docs/decisions/2026-11-20-scope-and-team.md`. William owns scope and signs changes.*

**One line:** know what you're buying before you trade a TapeOut miner.

## The problem

A TapeOut miner is a circuit NFT that earns BEM under Proof of Design. Miners are bought and sold on TapeOut's circuit market on BNB Chain, and since October they can be bridged to X Layer as RIG vouchers, sold there and borrowed against through TapePool. Before anyone pays for a miner or lends against one, three things are unclear:

- **Is it the real thing?** Anyone holding transistors can tape out a byte-for-byte copy of someone else's circuit, and anyone can tape out a netlist made only of REF records that points to another circuit, at zero transistor cost. On 25 October two collections held up to about 1,400 toy circuits and hundreds of pure-REF wrappers, and some markets listed them as compliant (TAPs issue #102). Nothing checks existing circuits.
- **What is it worth?** Asking prices for mining miners run from 0.015 to 222 BNB per unit of weight. Sellers guess and buyers can't tell a fair ask from a silly one.
- **What can I do with it?** Hold, sell, borrow or rent: each lives somewhere different, and some don't exist yet.

**The market today** (TapeOut's BNB circuit market, 7 days to 19 November): 167 listings of active miners by 19 sellers, about 10 sales a day (31 BNB in the week), 9 distinct buyers. X Layer has 15 RIG vouchers, no asks or bids, and TapePool held 0.01 BEM. Small, early, and growing on X Layer: the time to put trust in place is before the money arrives.

## What Foreman is

For any miner or RIG voucher, Foreman answers three questions, and publishes the answers on X Layer:

1. **Is it original?** Flags exact copies and wrappers, with the evidence. Shows OCCC status where a circuit is in an OCCC collection.
2. **What's it worth?** An estimated value range and payback, from chain data.
3. **What can I do with it?** Hold, Sell, Lend and Rent, each shown as it really is today.

**Foreman never holds a miner, never lends, rents or trades, and never calls anything fake.** It states what the chain shows: "byte-identical to circuit X, taped out 3 days earlier".

## Users

| User | What they want | What they get | Pays? |
| --- | --- | --- | --- |
| **Buyer** (primary) | Not to pay for a copy or a wrapper, and not to overpay | Originality, value range and payback for any listing | Free; premium alerts later |
| **Owner** | Know if someone copied their circuit; know what their miner is worth | Copy alert; value; what they can do with it | Free |
| **Markets and wallets** (TapeOut's market, OwlGate) | Stop listing copies and wrappers as compliant | Originality results on X Layer, readable on chain, and an API | API |
| **Lenders** (TapePool) | Not to lend against a copy, and a second opinion on value | The same results on X Layer, before a loan | API |

## How it works

| Step | What happens |
| --- | --- |
| 1. **Index** | Every circuit on every BNB Chain processor (80,290 on 20 Nov). Tape-outs from one `TapedOut` scan, keeping only factory-listed processors, with each processor's count checked against `nextId()`; then each netlist and each miner's design commitment block. A job follows new tape-outs and miner starts every 5 minutes, and a check of a newer circuit catches up first (`docs/decisions/2026-11-20-circuit-index.md`); hash each netlist (input and output counts and bytes, each NAND's inputs put in order) |
| 2. **Check** | For each miner and each listed circuit (and anything pasted, on screen only): wrapper if the netlist is only REF records (follow the chain to the gates); copy if a circuit with an earlier design time (design commitment, else tape-out) has the same netlist hash, or "too small to tell" below the size floor; otherwise "no earlier copy found among N circuits checked". Every result says whether the circuit can mine and why; a miner's shows the mining contract's design bonus answer first. OCCC status where available |
| 3. **Value** | Valuation range and payback from the miner's weight, network weight and emission (`packages/valuation`) |
| 4. **Market** | Sell context from TapeOut's BNB market (recent sales and asks of comparable miners), TapePool's offer on X Layer, and Rent's "no market yet" |
| 5. **Publish** | Write each miner's and each listed circuit's result to Foreman's results contract on X Layer, with the rule version and the block it was read at |
| 6. **Show and alert** | The app shows the three answers with their evidence. An owner who connects a wallet gets "a copy of your miner was just listed" |

## The three answers on screen

| Answer | Shows |
| --- | --- |
| **Original?** | For miners and listed circuits (and anything pasted): for a miner, first the mining contract's answer ("Holds the design bonus" or not); then Foreman's verdict, one of: **Wrapper** (REF records only; points to which circuit, and which circuit at the end of the chain holds the gates) · **Copy** (of which circuit, designed or taped out when, same netlist hash, bytes identical or identical once gate inputs are sorted; by the same address or a different one) · **Too small to tell** (identical to N earlier circuits, below the stated size floor) · **No earlier copy found** (among how many circuits checked, up to which block) · **Can't check** (and why). Plus facts where they apply ("1,204 of its 1,209 gates come from other circuits") and "Official (OCCC)", and always "Can mine" with the reason. The limit is stated: a copy with its gates reordered isn't detected. Rules: `docs/decisions/2026-11-20-copy-and-wrapper-rules.md`, `docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md` |
| **Worth?** | Estimated value range over 30 days and until the 2030 halving, its inputs, and payback for the asking price |
| **Options?** | **Hold**: the value range · **Sell**: "no bid right now", recent sales and asks of comparable miners (labelled, with the rule that picked them), and a listing the owner signs · **Lend**: TapePool's advance, or "no offer" · **Rent**: "no rental market yet" |

A missing offer is shown as missing, never as zero.

## MVP scope

**In:**

- Circuit index and originality check (copies, wrappers) across every BNB Chain processor. X Layer circuits are later, once the X Layer factory is confirmed.
- Valuation range and payback for any miner.
- Sell context, Lend and Rent states, as above.
- Results contract on X Layer and a job that publishes results to it.
- Web app: paste a miner, a listing or a RIG voucher and get the three answers; a page that checks every live listing on the BNB market.
- Copy alert for owners who connect a wallet.
- OCCC status where a circuit is in an OCCC collection.
- README with the originality rules, valuation backtests and every contract address.

**Stretch:** API for markets and lenders · alerts by email or Telegram · price conversion BNB/OKB to BEM on screen.

**Out:** autopilot, agent keys, rules circuits, AI rules drafting, paper runs, auto-bids, the Telegram bot, Chinese language, strategy marketplace, holding or trading anything, any number or verdict that comes from a model call.

## Build order (one person and an agent)

Build so each step works end to end before the next.

| When | What |
| --- | --- |
| 20–21 Nov | Docs and decision (this); find where netlists live on chain and the REF record format (TAP-02 §4, §6); record a fixture of real circuits including a known copy and a known wrapper |
| 22–24 Nov | Netlist reader and hashing; copy and wrapper detection on the fixture, test first; index every circuit since launch (archive node) |
| 25–26 Nov | Connect valuation and payback to `Miner` and `NetworkState`; Sell comparables rule; Lend and Rent states |
| 27–29 Nov | Results contract on X Layer (testnet first, then mainnet, deployed by William); publish job |
| 30 Nov–1 Dec | Mocks with `impeccable`, 2–3 directions per page, William chooses |
| 2–3 Dec | Build the chosen pages; live-listings check; copy alert; OCCC status |
| 4 Dec | Real users: check real listings, share results; README |
| **5 Dec** | **Feature freeze**; demo video |
| 6 Dec | Submit, a day before the provisional 7 Dec deadline |

**Cut list, in this order, if behind on 1 December:** DeWEB mirror (`decisions/2026-11-23-hosting.md`) → copy alert notifications by Telegram and browser (`decisions/2026-11-23-copy-alert-notifications.md`) → OCCC status → copy alert → Lend read (show "not checked") → X Layer mainnet (publish on testnet for the demo).

**Never cut:** the evidence behind every originality result, the inputs behind every value, and publishing results on X Layer (the hackathon's hard requirement).

## Demo story (three minutes)

1. A real listing on TapeOut's market. Paste it into Foreman.
2. **Original?** "Wrapper: REF records only, points to circuit #X" (or "Copy of #X, taped out 3 days earlier"), with the evidence.
3. **Worth?** The value range from its own weight, next to the asking price.
4. **Options?** Hold, Sell, Lend and Rent as they really are.
5. The result is published on X Layer; show the transaction and read it back from the contract.
6. The live-listings page: how many of today's listings are copies or wrappers.
7. An owner connects a wallet and sees "a copy of your miner was just listed".

## Still open

Mirrors "Still open" in `CLAUDE.md`. Strike an item when a decision settles it.

- ~~Where netlists are stored on chain, and the exact REF record format (TAP-02 §4, §6).~~ Settled: `docs/notes/2026-11-20-netlist-storage.md`, `docs/decisions/2026-11-20-copy-and-wrapper-rules.md`.
- ~~The size floor for "too small to tell": measured from the index.~~ Settled: 4 gates, `docs/decisions/2026-11-20-size-floor.md`.
- ~~Can a REF-only wrapper or an exact copy mine, and with what weight?~~ Settled: `docs/notes/2026-11-20-what-can-mine.md`, `docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md`.
- ~~How to index every circuit since launch: tape-out events, archive node limits.~~ Settled: `docs/decisions/2026-11-20-circuit-index.md`.
- Is OCCC deployed anywhere, and how is its status read?
- ~~Results contract on X Layer: its shape, and who holds the publisher key.~~ Settled: `docs/decisions/2026-11-21-results-contract.md`.
- Price conversion: `Price` is USD per BEM only; showing a BNB ask next to a BEM value needs BNB and OKB prices.
- Hosting for the API, the jobs and Postgres.
