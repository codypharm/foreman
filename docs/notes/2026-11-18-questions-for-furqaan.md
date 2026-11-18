# Questions for Furqaan from the page mocks, 18 November 2026

*For Furqaan, from William. Every MVP page now has a chosen mock in `docs/mocks/`. Each mock assumed something that is your call. Below is what each page needs from you, in the order the build needs it, with what the mock assumed. Answer "fine" or change it. Nothing here widens the data contract: these are requests for you to put into it.*

## Summary

| # | Question | Mock assumed | Needed by |
| --- | --- | --- | --- |
| 1 | What a miner and a valuation look like in the data contract | The fields in table A | 24 Nov |
| 2 | What an offer looks like, and when the X Layer offer reader lands | The fields in table B | 24 Nov |
| 3 | Where the BEM price comes from, and who owns it | One price with its age; stale after 1 hour | 24 Nov |
| 4 | Do miner NFTs carry an image? | No: a two-letter badge stands in | 24 Nov |
| 5 | **May an agent key sell?** A sale moves the miner out of the owner's wallet | Sell is allowed on the key, only at or above the owner's floor | 28 Nov |
| 6 | What the policy looks like, and how the plain-words read-back and examples are made | Numbered rules, one per option, each with allowed and refused examples from live offers | 28 Nov |
| 7 | What tape-out returns | Circuit address, gate count, number of inputs tested | 28 Nov |
| 8 | Saved offer history for the paper run | The last 30 days of offers, replayed | 28 Nov |
| 9 | What an agent key carries | Allowed options, moves a day, expiry; revoke in one tap | 28 Nov |
| 10 | Does a refused move leave a transaction, and does it count toward the daily limit? | Yes, and yes | 28 Nov |
| 11 | What an action log entry looks like | The fields in table C | 28 Nov |

## Needed by 24 November: miner page and decision screen

These two are first to build (24–27 Nov in the build order).

**1. Miner and valuation.** The miner page shows every valuation input with where it came from (chain or assumption) and the block. The valuation side is mine (`packages/valuation`), but the miner fields come from your readers.

*Table A: what the miner page and decision screen show*

| Field | Example in the mock | From |
| --- | --- | --- |
| Miner key | `0x3f9a…c21e` | Your reader |
| Verified or not | Verified | Your reader |
| Holds the design bonus | Yes | Your reader |
| Weight, and weight without the bonus | 412, and 96 without it | Your reader |
| Task | Task 7 | Your reader |
| Network weight (verified) | 1,609,667 | Your reader |
| Emission to verified miners | 7,127.999715 BEM a day | Contract constants (see `docs/notes/2026-11-18-mining-contract-findings.md`) |
| Block read at | 134,351,215 | Your reader |
| Low, base, high over a horizon | 11.08 · 51.69 · 54.73 BEM over 30 days | Valuation engine |
| Network growth assumed (low, base, high) | 1.0 · 0.4 · 0.0% a day | Valuation engine |
| Model version and backtest status | v0.1 · backtest pending | Valuation engine |

Question: are "holds the design bonus" and "weight without the bonus" readable per miner? The low case depends on them.

**2. Offers.** The decision screen ranks Hold, Rent, Lend and Sell in BEM against holding. Today the offers are made up, because the X Layer addresses (RIG, rentals, TapePool) are not in "On-chain facts" yet.

*Table B: what an offer needs to carry*

| Option | Fields the screen uses |
| --- | --- |
| Rent | BEM a day, number of days, when the offer was read, when it expires |
| Lend (TapePool) | BEM received now, how repayment works (from output, until paid), when read |
| Sell | Bid in BEM, when read, when it expires |
| All | Which miner, where the offer is (X Layer market or TapePool), and "no offer" as its own state, never zero |

**3. BEM price.** It is shown only to give a dollar figure, with its age ("41 min old"), and greyed out as stale. It is not in the ownership table. Is it yours (reader) or mine (API job)? "Price feed and API" is first on the cut list, so a single source is enough.

**4. Miner image.** If miner NFTs have an image, the badge becomes that image. If not, nothing changes.

## Needed by 28 November: rules, tape-out, paper run, agent key, action log

These are built 28 Nov to 1 Dec, alongside your wallet module and agent loop.

**5. May an agent key sell?** This is a trust rule, so it is yours. The rules say the agent key "can never transfer a miner out of that wallet" and "selling is off unless the owner turns it on". A sale is a transfer out. The agent key mock shows Sell as allowed (only at or above the owner's floor), with "It can never: Move your miner out of your wallet" listed below it. Those two lines contradict each other. Options I can see:

- **a. A key can never sell.** Autopilot rents and lends; a sale is always signed by the owner. The rules screen still takes a floor, and autopilot only alerts when a bid beats it. Simplest and matches the trust rule word for word. *My recommendation.*
- b. A key can sell only when the owner switched selling on and the rules circuit says yes. The trust rule's "never transfer out" becomes "never transfer out except a sale the owner allowed".
- c. A key can list for sale but not complete a sale; the owner signs the final step.

**6. Policy and read-back.** The rules screen shows the owner's rules back as numbered cards, one per option ("Rule 1 · Never sell below 400 BEM"; "Rule 2 · Only rent for 30 days or less, and only if it pays more than holding"; "Rule 3 · Borrow at most 25 BEM"), each with allowed and refused examples taken from live offers, plus one question when the text is ambiguous. That means the policy has to be shown rule by rule in plain words, and examples have to be checked against it. Does the policy schema fit that?

**7. Tape-out.** The setup screen shows the rules circuit's address (demo step 4), its gate count (412 in the mock) and how many inputs it was tested on (4,096). Will tape-out return all three?

**8. Offer history for the paper run.** The paper run replays the last 30 days of offers against the rules ("61.10 BEM against 52.80 holding · 2 moves made, 4 refused"). That needs offers saved over time, not just the live ones. Can the X Layer offer reader keep a history from the day it starts? If it can't reach 30 days back by the demo, I'll replay a shorter window and say so on screen.

**9. Agent key.** The agent key mock prefills the key from the confirmed rules: allowed options, 3 moves a day, 30 days. The owner can edit them before signing in OKX Wallet. It then shows moves used today and a one-tap revoke. The action log says revoke "takes effect on the next block". Is that right for your wallet module?

**10. Refused moves.** The action log shows a refused move with a transaction your wallet stopped ("the miner stayed put"), and counts it toward the daily limit. If refused moves are checked without a transaction, the line becomes "checked on chain by your rules circuit" with no transaction link.

**11. Action log entry.** Each entry is written by your agent loop and shown by my page.

*Table C: what an action log entry needs to carry*

| Field | Example in the mock |
| --- | --- |
| Miner key | `0x3f9a…c21e` |
| When | 18 Nov, 14:05 |
| Kind | Done, Refused, Key (issued, expired, revoked), Setup (tape-out, paper run) |
| What | Sell 3F for 380 BEM |
| Offer it acted on | 380 BEM bid on the X Layer market |
| Rule that allowed or refused it | Rule 1 · Never sell below 400 BEM |
| Rules circuit and its answer | `0x5b1e…c09d` · no |
| Transaction | `0x9c4d…e1a0` |
| What the other options paid | Rent 59.40 · Hold 51.69 · Lend 48.95 (BEM over 30 days) |
| Retried | Always no |

"What the other options paid" can come from my option ranking at the time of the move, if the entry carries the block it was decided at. Your call which side records it.

## Where the assumptions are written down

Each mock's header lists what was settled and what is open: `docs/mocks/2026-11-18-*.html`. Open them in a browser to see the pages.
