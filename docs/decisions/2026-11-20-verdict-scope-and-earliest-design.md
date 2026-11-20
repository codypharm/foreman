# Verdict scope and earliest design: who gets a verdict, what "earlier" means, what the hash compares

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling (one question at a time, each with a recommended answer; every recommendation was taken)
- **Research:** `docs/notes/2026-11-20-what-can-mine.md` (the verified mining source and on-chain reads)
- **Supersedes:** decisions 1 and 2 of `2026-11-20-copy-and-wrapper-rules.md`. Decisions 3 to 7 of that record stand.
- **Changes a locked trust rule:** "The earliest tape-out is the original" becomes "The earliest proven design is the original" (decision 4).
- **Changes:** `Originality` and `CircuitRef` in `docs/data-contract.md` (still provisional)

## Context

The earlier record gave verdicts to miners only. The verified mining contract (`src/PodMining.sol`, sealed) then showed four things:

1. **A netlist with any REF record can't mine** (`Nref`). Under "miners only", the Wrapper verdict and the REF rules (decisions 5 to 7) would never be used. Wrappers still matter on the market: issue #102 is about markets listing them as compliant, and 101 of the 218 items listed in the 7-day market read were not miners.
2. **Within one processor, the contract already ranks identical designs.** One miner per task per processor holds the design bonus. A copy keeps mining without it.
3. **"Earliest tape-out" can be gamed.** The source explains that a bot can copy a netlist from the mempool and tape it out first with more gas, which gives it the lower circuit id. The contract's defence is a design commitment: a hash of the netlist posted before the tape-out, accepted at `start` and stored as the miner's `commitBlock`.
4. **One swap changes the hash.** Swapping the two inputs of a NAND gate leaves the circuit's behaviour, gate count, depth and cost unchanged but changes its keccak hash. The authors measured that 262 of 267 bonus-holding netlists could be changed this way for free.

## Decisions

### 1. Verdicts for miners and listed circuits

*Options:* miners and listed circuits; every circuit; miners only.

Foreman gives an originality verdict to **every miner** (including the miner behind a RIG voucher) **and to every circuit listed on TapeOut's circuit market**, whether it mines or not. The index still holds every circuit as the comparison set. This supersedes decision 2 of the earlier record.

### 2. Every checked circuit gets a "Can mine" fact, with the reason

*Options:* yes, with the reason; yes or no only; no fact.

One of:

- **Mining now:** an active miner.
- **Can't mine: processor isn't eligible:** the processor's multiplier in the mining contract is 0.
- **Can't mine: uses REF records:** the netlist has at least one REF record.
- **Could mine: not started:** nothing above rules it out.

"Could mine" never promises that the circuit passes a task's test vectors. It says only that the two hard rules don't rule it out.

### 3. For a miner, the contract's answer first, the copy check beside it

*Options:* contract first, copy check beside; copy check only; contract only for miners.

A miner's originality shows the mining contract's own answer first: **"Holds the design bonus"** or **"Doesn't hold the design bonus"**, from `getMiner` (`optimal`, `bonus`). Foreman's verdict sits beside it, labelled as Foreman's. The copy check catches two things the contract can't see:

- copies **across** the two mining processors, since each processor has its own bonus slot;
- a miner whose netlist was first taped out on a processor that can't mine.

Both answers are shown, each with its source. Neither overrides the other.

### 4. The earliest proven design is the original

*Options:* earlier of commitment or tape-out; tape-out only, with disagreements flagged; tape-out only, no exception.

A circuit's **design time** is its design commitment block when the mining contract accepted a commitment for it (`commitBlock` > 0) and that block is before its tape-out block. Otherwise it is the tape-out block. The circuit with the earlier design time is the earlier one.

- **Ties:** when two design times fall in the same block, the lower tape-out (block, then transaction index, then log index) is earlier. This matches the contract's own fallback to the lower circuit id when commitments tie.
- **Where commitments come from:** only miners can have one, because the contract checks it at `start`. The miner's `commitBlock` and the `DesignCommitted` event in that block are the evidence, and anyone can re-read them.
- **On screen:** the rule is stated as "The earliest proven design is the original: a design commitment on chain, or else the tape-out." A copy decided by a commitment says so: "Identical to circuit #X; this design was committed at block B, before #X was taped out."

This changes the locked trust rule "The earliest tape-out is the original". Without the change, a front-run designer would be labelled the copy of the bot that copied them.

### 5. The hash sorts each NAND's two inputs first

*Options:* sort gate inputs and state the limit; bytes only and state the limit; full structural match.

The netlist hash covers `nIn`, `nOut` and the netlist bytes, **with each NAND record's two inputs written in ascending order** before hashing. A copy with swapped inputs gets the same hash. Swapping a NAND's inputs never changes what the circuit does, so this can't make two honest circuits match that wouldn't match anyway. LATCH and REF records are hashed as they are.

- **Evidence:** the raw byte hash is kept too. A copy says whether the bytes are identical or identical once gate inputs are sorted.
- **Stated limit, on screen and in the README:** "Checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn't detected."
- The exact encoding is fixed in the rule version when the netlist reader is built.

This supersedes decision 1 of the earlier record.

### 6. Anything pasted is checked; only miners and listed circuits are published

*Options:* check on screen and publish only miners and listings; "not checked"; check and publish anything.

A circuit that is neither a miner nor listed, for example one bought privately, still gets its verdict and facts in the app. Only miners and listed circuits are written to X Layer. That keeps the gas bounded and the published set well defined.

## Order the rules run in

1. Can't read the netlist, or the circuit is outside the index → **Can't check**.
2. Netlist is only REF records → **Wrapper** (decisions 6 and 7 of the earlier record).
3. A circuit with an earlier design time (decision 4) has the same hash (decision 5):
   - below the size floor → **Too small to tell** (earlier decision 3);
   - otherwise → **Copy** (earlier decision 4 adds the address fact).
4. Otherwise → **No earlier copy found** among N circuits, up to block B.

Every result also carries the "Can mine" fact (decision 2). A miner's result also carries the design bonus answer, shown first (decision 3). Earlier decision 5's REF fact is added wherever it applies.

## Consequences

- `docs/data-contract.md`:
  - `CircuitRef` gains `designCommittedAt`.
  - `Originality` gains `scope` (miner, listed or pasted).
  - The `copy` verdict carries `bytesIdentical` and `earlierBy`.
  - New facts: `can-mine` and `design-bonus`.
  - `PublishedResult` covers miners and listed circuits only.
  - The hash rule is rewritten.
- `CLAUDE.md`: the trust rule is reworded. The Copy and Netlist hash definitions change. "Can mine" joins the domain language. The mining eligibility rules, the design commitment, the processor factory and the two eligible processors join "On-chain facts". "Can a REF-only wrapper or an exact copy mine" is struck from "Still open".
- `docs/PRODUCT.md`: "How it works" and "Original?" follow this record, and the same item is struck from "Still open".
- **Tests** (`CLAUDE.md`, "Tests that are not optional"): the fixture needs a pair that differs only by swapped NAND inputs (a copy), a miner with an accepted commitment taped out after an identical circuit (not a copy), and one circuit for each "Can mine" state.
