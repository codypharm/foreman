# A FabX circuit's result page

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, one question with a recommended answer and its alternative (decision 1). Decisions 2 to 4 apply `2026-11-25-fabx-copy-check.md`, decisions 2, 6, 8 and 10, and the chosen mock `docs/mocks/2026-11-25-fabx-result.html` (B)
- **Extends:** `2026-11-21-api-endpoints.md` (`GET /circuit`) and `2026-11-21-circuit-page-reads.md`. Neither is edited

## Context

`GET /circuit/:processor/:tokenId` read every circuit as a BNB Chain circuit: its miner, its multiplier, BEM's price and its offers from TapeOut's contracts. For a FabX circuit that gave wrong answers: "not mining", multiplier 0, and Sell, Lend and Rent offers that belong to BNB Chain miners. FabX isn't valued (`2026-11-25-fabx-copy-check.md`, decision 8), so most of the page has nothing true to say for FabX.

## Decisions

### 1. `CircuitPage` is one of two shapes: BNB Chain's or FabX's

`CircuitPage` is a BNB Chain circuit's page, unchanged, or a FabX circuit's page. They are told apart by the page's `fabx` part, and the parser ties each one to its chain: a BNB Chain page's circuit is on chain 56 and a FabX page's on chain 196. BNB Chain pages and their checks don't change.

*Rejected:* one shape with a "not covered" state added to value, payback and each offer, and the multiplier and BEM price made optional. FabX's rules would reach into every field and every check on BNB Chain pages.

### 2. What a FabX page carries

- the circuit and its stored result, or a result built on request when it isn't a miner (`scope: "pasted"`, never published);
- whether its result was published;
- FabX's stored miner record: its task and the X Layer block it was read at, or none when the circuit isn't a FabX miner;
- FabX's state: its mining contract (from On-chain facts), the X Layer block its history is stored up to, and the block it froze at, if it is frozen.

Everything comes from what is stored with FabX's history. The page makes no live read.

The parser also refuses a FabX page whose result:

- is about another circuit;
- names a mining contract other than FabX's;
- is a miner's result without FabX's miner record, or the other way round;
- is "listed". FabX's market isn't read.

### 3. No value and no offers for FabX

The page shows "Value: not covered yet" in place of Worth?, and fixed lines in Options: Hold "Not covered yet", Sell "Not read", Lend "No offer" (TapePool lends against RIG vouchers, which stand for BNB Chain miners) and Rent "No rental market yet". These are wording in the app, not fields in the response.

### 4. The mining contract panel, on both chains' results

As in mock B, a panel under the header names the mining contract by its On-chain facts name and its address:

- **FabX results** add the fact line and the caveat with the X Layer block the result was read at.
- **While FabX is frozen,** the panel turns red and carries the notice.
- **A BNB Chain result** gets "TapeOut · BNB Chain" and the address, and only when its result names TapeOut's mining contract.

## Consequences

- `docs/data-contract.md`, `CircuitPage`: the FabX shape is added beside the existing one.
- "Miners on this design" shows the total. Mock B split it by chain, but `design-shared` carries one count; a split would be a contract change.
- Original? names a circuit's chain when it differs from the result's own circuit ("Copy of circuit #97 on BNB Chain"). It also names both blocks, and states the rule "on either chain, by the time of its block" once a result was checked across both chains.
