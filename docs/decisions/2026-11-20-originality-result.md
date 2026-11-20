# The originality result: times, rule version and how common a design is

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, one question at a time, each with a recommended answer (every recommendation was taken)
- **Builds on:** `2026-11-20-copy-and-wrapper-rules.md`, `2026-11-20-verdict-scope-and-earliest-design.md`, `2026-11-20-size-floor.md`
- **Changes:** `CircuitRef`, `OriginalityFact` and `ruleVersion` in `docs/data-contract.md` (still provisional)

## Context

The copy check, the wrapper check and the circuit index are built. Assembling one miner's full `Originality` result was checked against the data contract and the full index up to block 134,690,552. Two findings made the work smaller, and three gaps needed a decision.

### Findings

- **No miner has a REF record:** 0 of 20,900. The mining contract's `start` reverts on any REF record (`docs/notes/2026-11-20-what-can-mine.md`), so a miner never gets the **Wrapper** verdict. Wrapper results apply to listed circuits only.
- **Every REF record points inside the index.** Of the 80,290 netlists, 6,781 have REF records (6,681 pure wrappers, 100 with gates of their own as well), and no target is missing from the index. Wrapper chains can be followed from the stored netlists, with no reads from the chain.

## Decisions

### 1. Store times for tape-outs and design commitments

*Options:* store both in the index; read block times each time a result is built; show block numbers only.

A buyer reads "taped out 3 days earlier", not a block number, and BNB Chain's block time has changed over its life, so a time can't be worked out from a block number. The contract's `CircuitRef` already has `tapedOutAt.time`; it gains a time for the design commitment as well.

- **Tape-out time** comes from `blockTimestamp` on the `TapedOut` logs the scan already reads. It costs nothing new. Rows saved before this change are filled once.
- **Design commitment time** is the time of the commitment block, read once per block (7,635 blocks on 20 November) and stored with the miner.

Each time is the block's own timestamp, so a published result stays reproducible.

### 2. The rule version is spelled out

*Options:* spelled out; one label with a table in the docs.

`ruleVersion` names every setting that can change a result, e.g. **`hash 2026-11-20, floor 4, chain 10`**: the netlist hash rule, the size floor in gates and the wrapper chain step limit. Anyone holding a published result can recompute it without finding a table. Changing any of them is a new ADR and a new rule version.

### 3. A new fact: how many miners use this design

*Options:* add it; leave it out.

Results carry **"1 of 3,021 miners using this design"**: the miners in the index with the same netlist hash, this one included, up to the index's block. It is shown when the count is 2 or more, beside Copy, Too small to tell and No earlier copy found. It tells the earliest circuit's buyer something too: "3,020 later miners use this design".

It is a count, never a judgement, and it never changes a verdict or a value. On 20 November, 8 designs account for about 6,200 of the 11,126 copies at the 4-gate floor (`2026-11-20-size-floor.md`).

## Consequences

- `docs/data-contract.md`:
  - `CircuitRef.designCommittedAt` becomes `{ block: bigint; time: bigint } | null`, matching `tapedOutAt`;
  - `OriginalityFact` gains `{ fact: "design-shared"; miners: number }`;
  - `ruleVersion`'s format is written down;
  - the line "until the floor is measured, no copy verdict is issued" now names the 4-gate floor.
- **The index** (`packages/index`) gets a migration: a tape-out time on every circuit and a commitment time on every miner with a commitment. The tape-out scan keeps `blockTimestamp`; the commitment backfill reads its block's time.
- **The loader** refuses to load while any stored time is missing, as it already does for unread commitments, so a result never shows a blank or a made-up date.
