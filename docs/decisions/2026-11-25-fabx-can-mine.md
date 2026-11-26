# What a FabX result says about mining

- **Date:** 25 November 2026
- **Status:** Accepted
- **Decided by:** William, from three options (decision 1). Decisions 2 to 4 apply `2026-11-25-fabx-copy-check.md`, decision 10
- **Extends:** `2026-11-25-fabx-copy-check.md` (decision 10) and `2026-11-20-can-mine-revoked-and-stopped.md`. Neither is edited

## Context

Every result carries one can-mine fact. For a FabX circuit it comes from what FabX's contract reports, whose source isn't verified. At X Layer block 76,847,895:

| State | FabX circuits |
| --- | --- |
| Mining | 7,125 miners |
| Stopped (cooling) | 16 miners |
| Revoked | none |
| Not a miner | 23 circuits: 21 plain netlists and 2 wrappers (#6053 of #269, #6147 of #4206) |

For TapeOut, a stopped miner's fact gives "can start again from" its stop block + 1,200, the cooldown in TapeOut's verified code. FabX's cooldown would be an assumption about its unverified code.

## Decisions

### 1. A stopped FabX miner shows its stop block only

"Not mining: stopped at X Layer block B", with no block it can start again from. In the data contract, the stopped fact's `canStartFrom` becomes `bigint | null`: null for a FabX miner, and still stop block + 1,200 for TapeOut's. The stop block is `getMiner`'s `stopBlock` on FabX's contract, stored with the miner.

*Rejected:* assuming TapeOut's 1,200 blocks, which states a meaning of unverified code. *Rejected:* no result for a stopped FabX miner, which would drop 16 copy verdicts.

### 2. The other states

- **Mining now:** status 1, as FabX reports it.
- **Could mine: not started:** a FabX circuit with no miner record whose netlist has no REF records. FabX's processor is eligible, and any `ProcessorSet` event freezes FabX results (`2026-11-25-fabx-copy-check.md`, decision 6).
- **Can't mine: uses REF records:** a FabX circuit whose netlist has a REF record.

### 3. A revoked FabX miner gets no result

Decision 10 of the FabX copy check leaves out "failed a test vector", so a revoked FabX miner has no reason to show. It is a "Can't check" error, never a result, and never published. None exists today.

### 4. Every part of a FabX result is read at one X Layer block

The status and stop block are the ones stored with the miner, read at the X Layer block FabX's history is stored up to. They are not read live, so the copy verdict and the can-mine fact are the same moment.

## Consequences

- `getMiner`'s `stopBlock` is decoded for FabX miners and stored (`fabx_miners.stop_block`).
- The parser refuses a FabX stopped fact with a restart block, and a TapeOut one without.
