# Foreman

## Authority

**Human is architect. Agent is senior engineer.**

- **Furqaan is the team lead.** He owns the data contract, the trust rules and the final go/no-go, and reviews every merge. A change to the data contract, the trust rules, the rules compiler or the owner wallet module is his call, not the agent's and not an app session's.
- **Team:** Furqaan (lead · chain, circuits, wallet, AI agent) and William (valuation, API, app, demo). Full ownership table in `docs/PRODUCT.md`.
- **This session works with William:** the valuation engine and backtests, option ranking and offer display, paper runs, the API and jobs, the web app (miner page, decision screen, rules screens, action log, OKX Wallet, DeWEB mirror), the Telegram bot, Chinese language, the strategy marketplace UI, and the demo video, README and pitch.
- **Stay in your lane.** If William's work needs something from the chain readers, the rules compiler, the owner wallet module, AI rules drafting or the agent loop, write it up for Furqaan instead of building it. Do not edit another owner's area to unblock yourself.
- **The data contract is the one signed artifact.** It lives in `docs/data-contract.md` with types and parsers in `packages/contract` (`docs/decisions/2026-11-19-data-contract.md`): the shape of a miner, a valuation, an offer, a proposed action and an action log entry. Code against it; never widen it quietly. A field someone needs that the contract doesn't have is a note to the lead, not a local addition.
- **No spec ceremony.** This is a hackathon. `docs/PRODUCT.md` is the plan; its day-by-day table is the build order.
- **Grill before building against an unsettled requirement.** Invoke the `grill-me` skill: questions one at a time, each with a recommended answer. The queue is "Still open" at the end of this file. Not before every feature; before every guess. A grilling that settles something product-level becomes a dated ADR in `docs/decisions/`, and the item is struck from "Still open".
- **Before debugging, invoke the `diagnose` skill.** Build the fixture-based feedback loop first (one miner key, a saved block range of events, seconds to run) before theorising about a wrong valuation, an event that won't decode or a circuit that evaluates differently on chain.
- **Tests where wrongness is invisible** (see "Tests that are not optional"). Everywhere else, working code and a manual check are enough.
- Never make architecture decisions autonomously. Present 2–3 options with trade-offs; the human chooses. Record a real decision as a dated ADR in `docs/decisions/` (`YYYY-MM-DD-title.md`). Never edit a record after the fact; write a new one that supersedes it.
- Never bulk-generate code. One reader, one endpoint, one contract function, one circuit at a time.
- **Before writing more than one document, show the list of files and what each will contain, and wait for a yes.**
- **Every commit and every push needs its own explicit ask.** "Commit and push" once does not carry forward.
- If stuck or ambiguous: ask. Never guess on product behaviour.
- Flag risks immediately: a valuation that could be wrong in a way nobody would notice, an action the rules circuit did not check, a key or seed phrase anywhere near the repo, a mainnet transaction from a dev session, and anything that lets Foreman move a miner the owner did not allow. **The owner's control of their miner is the product.**

### Skills

`grill-me`, `diagnose` and `tdd` are used the same way as in SiteProof. **They are not in this repo yet:** copy them into `.claude/skills/` from the SiteProof repo before relying on them.

| Skill | When |
| --- | --- |
| `grill-me` | Before building against a requirement that is not settled. One question at a time, each with a recommended answer |
| `diagnose` | Before debugging. Feedback loop first |
| `tdd` | For the critical paths in "Tests that are not optional", with its approval-before-code planning phase waived |
| `impeccable` | For every frontend page and component: layout, typography, colour and polish. Not in this repo yet: add it to `.claude/skills/` before frontend work starts |

### Frontend: mock first, William chooses

- **Every page is mocked before it is built.** Use the `impeccable` skill to produce the mock: a static page with realistic sample data, no wiring to the API or the chain.
- **Show options, not one answer.** Mock 2–3 directions for each new page and present them side by side.
- **William chooses.** No page is built until William has picked a mock (or asked for changes and approved the revision). Record the chosen mock in `docs/mocks/` with the date.
- **Build to the chosen mock.** A change to layout or flow after the choice is a new mock and a new choice, not an edit made while building.

---

## Project

Foreman is an AI manager for TapeOut miners. It values each miner, compares **Hold, Rent, Lend and Sell** with live offers, and can run the miner on **autopilot** within rules the owner writes in plain English. Those rules are compiled into a **TapeOut circuit**, and the owner's wallet checks every action against that circuit on chain before it can happen.

A TapeOut miner is a circuit NFT that passed the official test vectors and earns BEM under Proof of Design. Mining runs on BNB Chain; since October an owner can also sell a miner, rent it out or borrow against it on X Layer. Owners still work out by hand which option pays best, and the answer keeps changing as network weight grows and the BEM price moves.

**What Foreman is not:** it never holds a miner, and it never lends or rents anything itself. It routes each miner to whoever pays best (TapePool for loans, the X Layer market for sales and rentals) and earns a fee for doing so.

**Positioning, in the UI and in the README:** Foreman shows estimated values as ranges and the outcome of each option under stated assumptions. It is not financial advice and it does not promise earnings. Never overstate this.

**Pitch line:** full autopilot for your miner. It never leaves your wallet, and your rules are enforced on chain.

Built for **X Layer TapeOut Accelerate** (OKX Build X series). Judged on user value and commercial potential, innovation, ecosystem integration, product readiness and a demo video of three minutes or less. Hard requirement: use TapeOut circuits, contracts or X Layer on-chain data, or run on DeWEB, and give the addresses.

| Milestone | When |
| --- | --- |
| Per-miner output check on BNB Chain | **Passed**, 18 November 2026 |
| Remaining go/no-go checks | See "Still open" |
| Feature freeze | 5 December 2026 (proposed) |
| Submit | 6 December 2026 (proposed); deadline 7 December 2026, 23:59 UTC, provisional |

### Key docs

| Doc | Path | Purpose |
| --- | --- | --- |
| Product | `docs/PRODUCT.md` | The problem, users, the eight-step pipeline, the four options, MVP scope, owners, build order, demo story. Source of truth |
| Brief | [Google Doc](https://docs.google.com/document/d/1PA3ftj2tFWzcKyj02hxZelqzRayx-DF3gd0w3vSYUjM/edit) | The research behind the product: revenue, competition, checks, risks |
| Data contract | `docs/data-contract.md` (not written yet) | Shared shapes and API paths |
| Decisions | `docs/decisions/` | Dated ADRs, never edited after the fact |
| Chain check | `scripts/check_pod_mining.py` | Reads recent BEM claims and the mining contract's per-miner events from BNB Chain |

---

## Trust rules (proposed: the team confirms, then they are locked)

| Rule | Detail |
| --- | --- |
| **Foreman never holds a miner** | Miners stay in a wallet the owner controls. The agent key can never transfer a miner out of that wallet, and selling is off unless the owner turns it on |
| **Models suggest, the circuit and code decide** | An AI model may propose an action or draft rules. No action executes unless deterministic code accepts it **and** the owner's rules circuit returns yes through eval() on chain. A refused action is logged and never retried in a different shape to get it through |
| **The owner confirms the rules before they exist** | Plain-English rules are compiled to a policy, shown back to the owner in plain words with worked examples ("this would be allowed, this would be refused"), and only taped out after the owner confirms. Never tape out unconfirmed rules |
| **No chain data, no number** | Every valuation shows its inputs (miner weight, network weight, emission, pool split, BEM price, block number) and the model version. No number shown to an owner comes from a model call |
| **Ranges, not prices** | A value is always low / base / high under stated assumptions, with published backtests. Never a single "price" |
| **Paper first** | No agent key is issued for a strategy until the owner has seen its paper run |
| **Keys are narrow and short-lived** | Every agent key has allowed actions, a daily action limit and an expiry date, and the owner can revoke it in one tap |
| **Unconfirmed addresses are never used** | A contract address is used only after it is confirmed on chain and listed in "On-chain facts" with the date |

### The four options

| Option | What the owner gets | Shown as |
| --- | --- | --- |
| **Hold** | Keeps mining and claiming | Expected BEM over 30 days and until the 2030 halving, as a range |
| **Rent** | A renter pays for the miner's output for a period | Best live rental offer and what it is worth against holding |
| **Lend** | Borrows BEM against future output (TapePool) | Best live loan terms, what is received now, how long repayment takes |
| **Sell** | A lump sum, and the future output is gone | Best live bid against the estimated value range |

---

## On-chain facts

Only facts confirmed on chain or on an official TapeOut page go here, each with its date. Everything else is in "Unconfirmed".

| Fact | Value | Confirmed |
| --- | --- | --- |
| Mining chain | BNB Smart Chain (chain id 56) | 18 Nov 2026 |
| BEM token (BNB Chain) | `0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a`, 8 decimals | 18 Nov 2026, script run |
| PoD mining contract (BNB Chain) | `0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46` (ERC-1967 proxy) | 18 Nov 2026, script run: every BEM mint came from a call to it |
| PoD mining logic contract (BNB Chain) | `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898`, behind the proxy; `src/PodMining.sol` verified on Sourcify (full match) | 18 Nov 2026, proxy implementation slot and Sourcify |
| Mining contract sealed | `isSealed = true`, owner renounced, not paused: no upgrades and nobody can pause | 18 Nov 2026, storage read at block 134,351,215 |
| Per-miner claim event | `Claimed(bytes32 indexed key, address indexed to, uint256 amount)`; topic0 `0x0508a8b4117d9a7b3d8f5895f6413e61b4f9a2df35afbfb41e78d0ecfff1843f`; topic1 = miner key (bytes32); topic2 = owner wallet; data = amount (8 decimals, equals the BEM minted). One event per miner, even when one transaction claims many | 18 Nov 2026, script run; name and topic0 from the verified source, 19 Nov 2026 |
| Batch claim function | selector `0x7ed51748` (name unconfirmed) | 18 Nov 2026, script run |
| Emission | 8,333,333 base units a second (7,199.999712 BEM a day) in era 0; 99% to the verified pool, 1% to unverified. Halves every 126,000,000 s from 21 Aug 2026 13:15:32 UTC; first halving 18 Aug 2030 21:15:32 UTC | 18 Nov 2026, verified source and storage read |

**Unconfirmed** (from other projects' READMEs, do not use until checked): X Layer TapeOut factory `0x1f09daefa827f02cbb40967cc91b259763760761`, account opener `0x536add8f30f03b69f6fbf29d425a816a0dc50106`, circuit market `0xd89f358c48a7B632c9845af2a02A32eB90DD75DB`. Also unknown: the X Layer miner voucher (RIG), rental and TapePool contract addresses.

**RPC notes:** `bsc-dataseed.bnbchain.org` refuses `eth_getLogs`; `bsc-rpc.publicnode.com` serves it in 200-block chunks. Several public nodes return 403 or reset the connection. Batch reads and cache by block.

---

## Tech stack

Each item gets 2–3 options, the human chooses, it gets an ADR in `docs/decisions/`, then it is filled in here. Items still marked Open are not decided.

| Job | Status |
| --- | --- |
| Reading BNB Chain and X Layer (indexer) | TypeScript with viem 2.57.16; `packages/chain-bnb`, later `packages/chain-xlayer`; tests on saved RPC responses: `2026-11-19-chain-readers.md` |
| Valuation engine language and hosting | TypeScript; token amounts as `bigint`, never `number`: `2026-11-18-language.md`. Hosting open |
| API and job runner | Hono on Node, Postgres, pg-boss: `2026-11-18-api-and-jobs.md`. Hosting open |
| Frontend | Vite, React, wagmi and viem; static build for DeWEB, OKX Wallet first: `2026-11-18-frontend.md` |
| Rules compiler route | Open: plain English → policy → Verilog → existing netlist tooling (such as TapeSynth), or our own netlist generator |
| Owner wallet | Open: our own smart wallet or module, or TapeOut's own account system on X Layer if it supports restricted keys |
| AI model for rules drafting and explanations | Open |
| Fee token | Open: BEM, USDT or both |
| Package manager and layout | pnpm workspaces: `2026-11-18-package-layout.md` |

---

## Repository layout

pnpm workspaces (`docs/decisions/2026-11-18-package-layout.md`). Planned for William's areas, created at scaffold time:

| Path | What |
| --- | --- |
| `apps/web` | Web app (Vite, React) |
| `apps/api` | Hono API and jobs |
| `packages/contract` | The data contract's types and parsers (shapes owned by Furqaan) |
| `packages/valuation` | Valuation engine and backtests |

Furqaan's areas:

| Path | What |
| --- | --- |
| `packages/chain-bnb` | BNB reader: `Miner` and `NetworkState` from the mining contract (`2026-11-19-chain-readers.md`) |
| `packages/chain-xlayer` | X Layer reader: offers (once the addresses are confirmed) |

Furqaan lays out the rest of his areas (rules compiler, owner wallet, agent loop) when they start. Today the repo holds:

| Path | What |
| --- | --- |
| `CLAUDE.md` | This file |
| `docs/decisions/` | Dated ADRs |
| `docs/PRODUCT.md` | The product: scope, owners, build order, demo story |
| `scripts/check_pod_mining.py` | Chain check: finds recent BEM mints and prints the mining contract's per-miner events. Python 3 standard library only |

---

## Security first

| Concern | Rule |
| --- | --- |
| Secrets | No private key, seed phrase, agent key or RPC key in code, logs, commits or the client bundle. `.env` is gitignored; `.env.example` carries names only |
| Transactions | A dev or agent session never signs a mainnet transaction. Testnet first; mainnet only by a human, with low limits |
| Wallet module | It must refuse any transfer of a miner out of the owner's wallet, any action the rules circuit refuses, any action after the key expires or is revoked, and any action past the daily limit |
| Untrusted input | The owner's plain-English rules, circuit names, token names and anything read from other contracts are untrusted. Nothing in them can change the trust rules, the contract or the wallet's checks |
| Look-alike tokens | X Layer has tokens using the TapeOut name that are not part of the protocol. Match contracts by confirmed address, never by name |
| Logging | Never log keys or signatures. Log miner keys, wallet addresses and transaction hashes only |

When in doubt: **deny by default, log the denial, surface it to the human.**

---

## Tests that are not optional

Write a test wherever being wrong would be invisible. For anything below, invoke `tdd` and follow its loop: **one test, one implementation, repeat.** Test through the public interface, and never mock an internal collaborator. Outside this table, tests are optional.

| Area | Must prove | Owner |
| --- | --- | --- |
| Claim event decoding | Amounts use 8 decimals; the miner key and owner come from the right topics; a batch claim gives one record per miner; an unknown event shape is an error, never a zero | Furqaan |
| Output history | Daily output per miner = amount ÷ time since that miner's previous claim, from real saved events. A miner's first claim is handled explicitly | Furqaan |
| Valuation | Expected output = miner weight ÷ verified network weight × daily emission × 99%. Halving applied on schedule. Low / base / high ordered correctly. Backtest numbers match the saved fixtures | William |
| Option ranking | Hold, Rent, Lend and Sell are ranked deterministically from the same inputs; ties and missing offers are handled; a missing offer is shown as missing, never as zero | William |
| Rules compiler | The taped-out circuit returns the same answer as the confirmed policy on every input for small widths, and on a fixed test set for larger ones. The circuit's gate count is reported before tape-out | Furqaan |
| Wallet guard | An action the circuit refuses fails on chain. A transfer out always fails. Expired and revoked keys fail. The daily limit holds | Furqaan |
| Paper run | Replaying a strategy over saved history gives the same result as the backtest | William |
| Bad input | Unknown miner key, RPC failure, chain reorg, stale price: a clear error, never a crash and never a silent zero | Both |

A number shown to an owner, or an action taken for one, that no test covers is a bug waiting to be found on demo day.

---

## Build order

The day-by-day table in `docs/PRODUCT.md` is the order, with an owner for each row. Build so each step works end to end before the next.

**Feature freeze is 5 December 2026.** After that: bug fixes, the demo video and the submission only.

**Cut list, in this order, if behind on 1 December:** price feed and API → strategy marketplace → Chinese → Telegram bot → autopilot on mainnet (keep it on testnet for the demo).

**Never cut:** value ranges with their inputs, the rules circuit check on every autopilot action, and one-tap revoke. Without them the product asks owners to trust us, which is exactly what it exists to avoid.

---

## Copy

- Use the product's words exactly (see "Domain language").
- Plain language for owners. No ABI, RPC or contract jargon in the UI.
- Say "estimated value", never "price", for Foreman's own numbers. Never "guaranteed", never "you should": show outcomes and let the owner choose.
- Every autopilot move is explained in one line: what it did, why, and what the alternative paid.
- English and Chinese. Mobile first, OKX Wallet first.

---

## Domain language (use exactly)

| Term | Meaning |
| --- | --- |
| **Owner** | Primary user. Holds one or more miners and chooses what to do with them |
| **Buyer** | Someone considering buying a miner on the X Layer market |
| **Miner** | A taped-out circuit NFT registered for Proof of Design mining that earns BEM |
| **Miner key** | The 32-byte id the mining contract uses for a miner in its events |
| **Weight** | A miner's share-determining figure in the mining contract |
| **Network weight** | Total verified weight across all miners |
| **Emission** | BEM produced per day by the mining contract (7,200 today, halving about every four years) |
| **Claim** | Withdrawing a miner's earned BEM; one event per miner |
| **Hold / Rent / Lend / Sell** | The four options for a miner. Never invent others in copy |
| **Offer** | A live rental rate, loan term or sale bid for a miner |
| **Estimated value** | Foreman's low / base / high value for a miner under stated assumptions |
| **Payback** | Days until a buyer's price is earned back, as a range |
| **Rules** | The owner's limits in plain English |
| **Policy** | The structured form of the rules, confirmed by the owner |
| **Rules circuit** | The taped-out TapeOut circuit that encodes the policy and is checked with eval() before every autopilot action |
| **Owner wallet** | The wallet the owner controls that holds the miner and runs the check |
| **Agent key** | The restricted, expiring, revocable key the autopilot acts with |
| **Autopilot** | Foreman acting for the owner with an agent key, within the rules circuit |
| **Paper run** | A strategy replayed on history or run live without real moves |
| **Strategy** | A rules circuit others can copy; its author earns a share |
| **Action log** | Every move, its reason and its transaction, sent to the owner |

Never abbreviate these. Never invent synonyms.

---

## Still open

The `grill-me` queue. Strike an item when an ADR settles it.

- ~~Read a miner's current weight, status and pending rewards: confirm the mining contract's source is verified on BscScan and list its read functions.~~ Settled: `docs/decisions/2026-11-19-data-contract.md`.
- X Layer: the miner voucher (RIG), rental and TapePool contract addresses, and sales, rentals and loans per week.
- Can a smart wallet hold a bridged miner and still rent it or lend it through TapePool?
- How many gates a realistic rules circuit needs.
- Do copied or wrapper circuits earn mining rewards (decides the copy discount)?
- Will TapePool and the market pay referral fees?
- Does anyone already publish fair values or a sell-vs-rent comparison?
- Every item still marked Open in "Tech stack": ~~chain readers~~ (settled: `2026-11-19-chain-readers.md`), rules compiler route, owner wallet, AI model, fee token, and hosting.

---

## What the agent cannot do

- Change the trust rules, the four options or the data contract without the team.
- Let a model call produce a valuation, an offer, an action or a citation that code has not checked.
- Execute an autopilot action that the rules circuit has not approved.
- Write code that can move a miner out of an owner's wallet.
- Sign or send a mainnet transaction, or handle a real private key or seed phrase.
- Use a contract address that is not in "On-chain facts".
- Deploy anything.
- Add a dependency without saying what it replaces and what it costs.
- Commit or push without being asked, each time.
- Write a batch of documents without first showing the file list and getting a yes.
- Build a frontend page before William has chosen its mock.
