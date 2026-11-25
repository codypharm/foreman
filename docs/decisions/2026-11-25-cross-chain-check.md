# The cross-chain copy check: unconfirmed commitments and one rule version

- **Date:** 25 November 2026
- **Status:** Accepted
- **Decided by:** William, two questions, each with a recommended answer and its alternative
- **Extends:** `2026-11-25-fabx-copy-check.md` (decisions 4 and 5) and `2026-11-25-fabx-commitment-designer.md`. Neither is edited

## Context

The copy check now compares every circuit with every identical circuit on BNB Chain and on FabX's processor on X Layer. Measured on the local index on 25 November 2026 (BNB Chain's index, and FabX up to X Layer block 76,847,895):

| What | Count |
| --- | --- |
| Designs on both chains | 71 |
| FabX circuits first of their design on FabX, with an earlier identical BNB Chain circuit | 70 (59 at 4 gates or more; 68 miners) |
| BNB Chain circuits first of their design on BNB Chain, with an earlier identical FabX circuit | 1 |
| Identical circuits taped out in the same second on both chains | 0 |
| FabX miners whose commitment has no event (unconfirmed) | 68 |
| Results an unconfirmed commitment would change | 34, all FabX miners (8 by their own commitment, 26 by another's); no BNB Chain result |

## Decisions

### 1. Any result an unconfirmed commitment would change is Can't check

A result is **Can't check: commitment-unconfirmed** when counting a FabX commitment that has no event would change its verdict, or the earlier circuit it names. This holds for BNB Chain results as for FabX results. The parser allows the reason on any circuit, as the data contract's sentence says ("where a commitment without its event would decide the order").

How "would change" is decided:

- The result is first built with no unconfirmed commitment counted.
- It is then rebuilt with **one unconfirmed commitment counted at a time**: the circuit's own, then each identical circuit's.
- If any of those rebuilds differs in verdict or in the circuit named, the result is Can't check.

One at a time is enough. Counting another circuit's commitment only moves that circuit earlier, so a set of them changes the result only if one of them does alone. Counting the circuit's own commitment only removes circuits from before it.

*Rejected:* allowing the reason only on FabX miners, with a BNB Chain result in that case left unbuilt as an error. That gives the same screen, but no published result.

### 2. One rule version for every result

Every result built with the cross-chain check, on either chain, carries:

> `hash 2026-11-20, floor 4, chain 10, BNB Chain and X Layer by second, FabX commitments by event`

Every result depends on the same settings, FabX's commitment rule included, since it can in principle change a BNB Chain result. FabX results are told apart by chain and mining contract, not by rule version.

*Rejected:* two strings, one per chain. That matches `2026-11-25-fabx-copy-check.md`'s wording literally, but a BNB Chain result could depend on FabX's commitment rule without saying so.

### 3. An unconfirmed commitment's second is its block's timestamp

Across chains, "would change" needs the second an unconfirmed commitment claims. It is the timestamp of the X Layer block its `commitBlock` names, read from X Layer and stored with the miner. A block's timestamp is X Layer's, not anything FabX's owner can edit.

## Consequences

- `CircuitIndex` holds both chains, each with the block it was read up to. Coverage counts both.
- Every result is rebuilt with the new rule version. The publish job publishes only what changed (`2026-11-21-publish-job.md`, decision 6), and the shape change already publishes everything once (`2026-11-25-republish-in-new-shape.md`).
