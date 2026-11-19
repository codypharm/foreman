# Data contract: shapes, wire format and the answers to William's questions

- **Date:** 19 November 2026
- **Status:** Accepted
- **Decided by:** Furqaan. Questions 1–3 were settled one at a time in a grilling. For the rest, Furqaan told the agent to take the best option on each; those choices are marked *(delegated)* so they are easy to review and supersede
- **Contract:** `docs/data-contract.md`; types and parsers in `packages/contract`
- **Answers:** `docs/notes/2026-11-18-questions-for-furqaan.md` (W1–W11 below are its question numbers)
- **Facts used:** `PodMining.sol`, verified on Sourcify (logic contract `0xa3dbe873…f898`), and `docs/notes/2026-11-18-mining-contract-findings.md`

## Context

The data contract is the one signed artifact: the shapes the chain readers, the valuation engine, the API, the web app and the agent loop all share. William's mocks for every MVP page assumed fields nobody had agreed, and the miner page and decision screen are built from 24 November.

## Decisions

### 1. Miner: a product shape, not a mirror of `getMiner`

The struct has 20 fields, most of them mining-contract bookkeeping (`debt`, `commitBlock`, `firstUnusedId`, `stopBlock`, `area`, `depth`, `nandBurn`, `latchBurn`). The contract's `Miner` carries only what the product uses: key, processor and token id, current owner, status, pool, task, weight, weight without the bonus, whether it holds the bonus, mining since, and the block it was read at. Network weight lives on a separate `NetworkState`.

*Why:* the app codes against what screens show; the chain stays the reader's business. *Cost:* a later need for a raw field (for example `area` for the copy discount) is a contract change.

**Answers W1's sub-question:** yes, both are readable per miner. Weight without the bonus is `bstar × mult`, exactly what `_demoteSlotHolder` sets.

**Correction to the findings note:** losing the bonus is not permanent. `reclaim(key)` lets an active, verified, demoted miner take the slot back and regain a bonus (`Reclaimed` event). The reader follows `Demoted` and `Reclaimed`. The valuation's low case is unaffected: it assumes the bonus is lost from today.

**Status values:** 0 none, 1 active, 2 revoked, 3 cooling (stopped; it can still claim for `STOP_COOLDOWN` = 1,200 blocks).

### 2. Wire format: decimal strings of base units

Types use `bigint`. On the wire every `bigint` is a decimal string of base units (BEM: 8 decimals; weights: plain integers; times: Unix seconds). Addresses and keys are lowercase hex, checked on parse. `packages/contract` exports a parse and serialise pair for each shape; a parse failure is an error, never a zero.

*Rejected:* decimal BEM strings (rounding disagreements), JSON numbers (silent loss above 2^53), a serialisation library (a dependency for about 20 lines).

This also confirms **`packages/contract`** as the contract's location.

### 3. Every valuation input carries its source

`Sourced<T>` is one of: read from the chain (chain id and block), a contract constant (a reference such as `PodMining.INITIAL_RATE`), or an assumption (a stated basis). A value without a source does not parse. The valuation carries per-scenario miner weight (the low case uses the weight without the bonus) and growth in parts per million as `bigint`, as `packages/valuation` already does. The parser enforces low ≤ base ≤ high.

### 4. BEM price: its own shape, owned by William's API job *(delegated)*

The price is not chain data and is used only for a dollar figure beside a BEM value. "Price feed and API" is first on the cut list, so a single source is enough. `Price` carries USD per BEM (8 decimals), its source and when it was read. Stale after one hour, greyed out. (W3)

### 5. No miner image field *(delegated)*

Sampled miners return an empty `tokenURI`. The two-letter badge stays; a field is added when a processor shows an image. (W4)

### 6. Offers: one shape per option, "no offer" is its own state *(delegated)*

Rent, Lend and Sell offers each carry the miner key, the venue (X Layer market or TapePool), the X Layer block it was read at, and an expiry where the venue has one. A missing offer is `{ state: "none", checkedAt }`, never zero. Venue-specific fields stay provisional until the X Layer RIG, rental and TapePool addresses are in "On-chain facts". (W2)

### 7. An agent key can never sell *(delegated)*

William's option a. The trust rule "the agent key can never transfer a miner out of that wallet" stands word for word. Autopilot rents and lends. The owner can still set a sell floor: when a bid beats it, autopilot alerts and the owner signs the sale. (W5)

*Rejected:* b, a key that sells when allowed (rewrites a trust rule into "never, except"); c, a key that lists but does not complete (a listing is still a commitment the owner did not sign, and doubles the wallet's surface).

### 8. Policy: typed rules; read-back and examples come from code *(delegated)*

A policy is an ordered list of typed rules, each with an id and the option it governs. The AI model only drafts a policy from the owner's English. The plain-words read-back is produced by fixed templates from the typed rules, and the allowed and refused examples by running live offers through the policy in code. The owner confirms what code produced, never model text. (W6)

### 9. Tape-out returns address, gate count and test coverage *(delegated)*

Circuit address, gate count, inputs tested, and whether testing was exhaustive or a fixed set. (W7)

### 10. Offer history is saved from the day the reader starts *(delegated)*

Backfilled from events if the market contracts emit them. The paper run replays whatever window exists and states its length on screen. (W8)

### 11. Agent key: allowed options, moves a day, expiry *(delegated)*

Allowed options are a subset of Rent and Lend. Revoke takes effect once the revoke transaction is confirmed; the copy says "as soon as the revoke is confirmed", not "on the next block". (W9)

### 12. A refused move is a transaction that executes nothing *(delegated)*

The owner wallet does not revert on a refusal: it emits `Refused`, moves nothing, and counts the attempt toward the daily limit, so an agent cannot probe the rules for free. Refusal is on chain and linkable from the action log. Revisit if the owner wallet decision lands on TapeOut's own account system and it cannot behave this way. (W10)

### 13. Action log entry: table C, plus the decision block and an alternatives snapshot *(delegated)*

The agent loop records what the other options paid at the moment of the move, with the block it decided at, so an entry never changes when the model version does. Kinds: done, refused, alert, key (issued, expired, revoked), setup (tape-out, paper run). "Retried" is not a field: a refused move is never retried, so there is nothing to record. (W11)

### 14. "Until the 2030 halving" replaces "over the miner's life" *(delegated)*

Signs off the open item in `2026-11-18-valuation-model.md`. `CLAUDE.md` and `docs/PRODUCT.md` are updated.

## Consequences

- **Demo story step 7 changes (William):** "selling below the floor" cannot be the refused move, because a key can never sell. Use a move the rules circuit refuses, for example a 60-day rental when the rules allow 30 at most.
- The rules circuit encodes Rent and Lend rules only. The sell floor is checked in code, for alerts.
- Offer fields, tape-out internals and the wallet's `Refused` event are provisional until the X Layer addresses and the owner wallet route are settled; a change there is a new ADR.
- "Read a miner's current weight, status and pending rewards" is struck from "Still open". Pending rewards: `pending(key)` plus this miner's share of emission since `lastUpdate` (see the findings note).
- `Claimed(bytes32,address,uint256)` is confirmed: its keccak-256 equals the topic0 in "On-chain facts".
