# Which designer confirms a FabX design commitment

- **Date:** 25 November 2026
- **Status:** Accepted
- **Decided by:** William, from three options
- **Refines:** `2026-11-25-fabx-copy-check.md`, decision 5 ("the same designer and processor"). That record isn't edited; this one says what "the same designer" means
- **Research:** `docs/notes/2026-11-25-fabx-history.md`

## Context

Decision 5 counts a FabX miner's design commitment only when FabX's mining contract emitted its `DesignCommitted` event, in the claimed block, "with the same designer and processor".

A commitment stays with its circuit. In TapeOut's verified `PodMining.start`, a restart copies the earlier `commitBlock` and `firstUnusedId` into the new record, even when someone else now holds the circuit. A new commitment is accepted only from its own designer, who must be the one calling `start`. So the designer can be an earlier holder, not the miner's current registrant.

Measured on FabX at X Layer block 76,847,895: 5,609 miners have a commitment block.

| Event found in the claimed block, on FabX's processor, with the miner's `firstUnusedId` | Miners |
| --- | --- |
| Designer is the current registrant | 5,501 |
| Designer is someone else, who started this circuit earlier in today's contract | 40 |
| Designer is someone else, who never started this circuit in today's contract | 9 |
| No event in the claimed block: migrated on 14 October | 54 |
| No event in the claimed block: other | 5 (#1020, #1305, #1987, #2069, #3119) |

## Decision

A FabX commitment is confirmed when today's mining contract emitted a `DesignCommitted` event:

- **in the block** the miner's `commitBlock` names, with the event's own block field equal to that block;
- **for FabX's processor;**
- **with the miner's `firstUnusedId`,** which is at most the circuit's id;
- **by a designer who started this circuit** at some point, as one of its `Started` events in today's contract shows.

On 25 November that confirms 5,541 commitments and leaves 68 unconfirmed. An unconfirmed one makes the result **Can't check** ("commitment-unconfirmed") only where it would decide which circuit is earlier (decision 5, unchanged).

## Options not taken

- **Any designer,** with block, processor and `firstUnusedId` alone (5,550 confirmed). Any commitment made in that block could then stand in for this circuit's.
- **The current registrant only,** as decision 5 reads literally (5,501 confirmed). A circuit sold and restarted would lose a commitment that `start` correctly carried over.

## Consequences

- FabX's `Started` events are stored with its other history, to know who started each circuit.
- The confirmation is stored with the event it rests on and never read again (decision 5).
