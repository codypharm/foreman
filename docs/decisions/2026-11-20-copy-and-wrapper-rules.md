# Copy and wrapper rules: what is compared, who gets a verdict, and how it reads

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling (one question at a time, each with a recommended answer; every recommendation was taken)
- **Research:** `docs/notes/2026-11-20-netlist-storage.md` (where netlists live, the REF record format from TAP-02, real copies and wrappers read on chain)
- **Changes:** `Originality` and `CircuitRef` in `docs/data-contract.md` (still provisional)

## Context

Netlists are readable from each processor contract (`netlist(id)`, `circuitInfo(id)`), and the format is written down in TAP-02: NAND, LATCH and REF records, with `nIn` and `nOut` stored beside the bytes rather than in them. Reads on 20 November found real pure-REF wrappers, a 1,204-gate netlist byte-identical on three processors, and four identical 3-gate circuits on one processor.

That last finding is the problem this decision solves. Small circuits come out byte-identical when different people build them honestly, and so can any circuit two people produce with the same deterministic tool from the same design. A rule that calls every later identical circuit a "copy" would call honest circuits copies. `CLAUDE.md` names that as the mistake the product must not make.

## Decisions

### 1. The netlist hash covers `nIn`, `nOut` and the bytes

*Options:* bytes only; or `nIn`, `nOut` and bytes.

`nOut` decides which signals are the outputs (the last `nOut` signals), so the same bytes with a different `nOut` are a different circuit. "Byte-identical" means the same circuit in every respect. The exact encoding hashed is written down with the rule version when the netlist reader is built.

### 2. Verdicts for miners only; the index holds every circuit

*Options:* a verdict for every circuit; or for miners only.

Foreman gives an originality verdict to **miners**, including the miner behind a RIG voucher. The index still holds **every** circuit, because a miner can copy a circuit that never mined, and the earlier circuit has to be in the comparison set. This skips thousands of toy circuits that buyers aren't buying as miners.

### 3. Small miners: a size floor measured from data

*Options:* report every match as a fact; a fixed floor chosen now; a floor set from measured data.

Below a stated gate count, a byte-identical match is shown as **"Identical to N earlier circuits; too small to tell"**, not "Copy". The number is **not** chosen yet. It comes from measuring the index first: at each gate count, how often miners from **different** tape-out addresses share a netlist. The rule and the number are shown on screen and carried in the rule version. Until the number is measured, the copy check does not ship.

### 4. Same creator: a fact, not a different verdict

*Options:* a separate "duplicate" verdict; a fact beside "Copy"; ignore who taped out.

The verdict stays **"Copy of circuit #X"**, with a fact beside it: **"taped out by the same address"** or **"by a different address"**, from each circuit's `TapedOut` event. A buyer can tell someone's own second mint from someone else's circuit, and the rule stays one rule.

### 5. REF records mixed with real gates: a fact, not a verdict

*Options:* a fact beside the verdict; a new "mostly REF" verdict with a threshold; don't show it.

Reuse through REF is an intended feature. A netlist with REF records and gates of its own gets its verdict as usual, and beside it a fact: **"Uses 1 REF to circuit #X: 1,204 of its 1,209 gates come from other circuits."** No threshold and no judgement.

### 6. Wrapper chains: name the direct and the final target

*Options:* the direct target only; the direct and the final target.

A pure wrapper can point to another wrapper (A → B → C). Foreman names both: **"Wrapper of #B, which is a wrapper of #C: the gates are in #C."** The chain is followed to the first circuit with gates of its own, up to a stated step limit. Past the limit, the verdict is "Can't check". Following a chain only reads netlists; it never evaluates a circuit.

### 7. Wrapper wins over Copy

*Options:* Wrapper with copy as a fact; Copy with wrapper as a fact.

A pure wrapper that is also byte-identical to an earlier circuit is shown as **"Wrapper of #X"**, with **"also byte-identical to circuit #Y, taped out earlier"** beside it. Having no gates of its own is the bigger fact for a buyer.

## Order the rules run in

1. Can't read the netlist, or the circuit is outside the index → **Can't check**.
2. Netlist is only REF records → **Wrapper** (decision 6 for chains; decision 7 adds a copy fact).
3. An earlier circuit has the same hash (decision 1):
   - below the size floor → **Too small to tell** (decision 3);
   - otherwise → **Copy** (decision 4 adds the address fact).
4. Otherwise → **No earlier copy found** among N circuits, up to block B.

Decision 5's REF fact is added to any verdict where it applies. Only miners get a verdict (decision 2).

## Consequences

- `docs/data-contract.md`: `OriginalityVerdict` gains `too-small-to-tell`; `Originality` gains `facts` (same or different address, REF use, also byte-identical); `wrapper` names the chain's final target; `CircuitRef` gains `tapedOutBy`; the hash rule is written down. Both shapes stay provisional until the netlist reader exists.
- `CLAUDE.md` and `docs/PRODUCT.md`: "Where netlists are stored on chain, and the exact REF record format" is struck from "Still open". "Too small to tell" joins the domain language and the copy rules.
- **New work before the copy check ships:** measure the size floor from the index. This belongs with indexing every circuit (22–24 Nov in the build order).
- **Tests** (`CLAUDE.md`, "Tests that are not optional"): the fixture needs a pure wrapper, a wrapper chain, a mixed REF netlist, a byte-identical pair from different addresses, one from the same address, and a small identical pair below the floor.
