# FabX's circuits and miners are stored in their own tables

- **Date:** 25 November 2026
- **Status:** Accepted
- **Decided by:** William, from three options
- **Extends:** `2026-11-25-fabx-copy-check.md`, `2026-11-20-database-access.md`. Neither is edited

## Context

The index's tables assume one chain. A tape-out's position (block, transaction index, log index) is unique across all circuits, and `index_state` holds a single block for tape-outs and one for miner starts. FabX's circuits are on X Layer, whose block numbers can meet BNB Chain's, and FabX's design commitments count only when their `DesignCommitted` event is found (`2026-11-25-fabx-copy-check.md`, decision 5), which BNB Chain's `miners` table has no place for.

## Decision

FabX gets its own tables, beside the BNB Chain ones:

- **X Layer circuits:** FabX's processor's tape-outs, netlists and hashes, with each tape-out's block time.
- **FabX miners:** each miner's status read from FabX's mining contract, its design commitment block, and the transaction of the `DesignCommitted` event that confirms it, or that none was found.
- **X Layer progress:** the X Layer block each of these is read up to, and FabX's frozen state (the block and event that froze it).

The BNB Chain tables and the code that reads and writes them are not changed. Loading the index for the copy check reads both and merges them into one list, ordered across chains by design time in seconds.

## Options not taken

- **A chain column on every index table,** with existing rows set to BNB Chain. One code path for both chains, but it changes every index query that works today, ten days before the feature freeze, and it is harder to take out if FabX is cut.
- **The chain held on the processors table only,** with the circuits' position key including the processor and X Layer columns added to `index_state`. Fewer changes, but BNB Chain's queries still change.

## Consequences

- Some saving and reading code is written twice, once per chain.
- If FabX is cut on 1 December, its tables and the merge are removed and nothing on BNB Chain changes.
