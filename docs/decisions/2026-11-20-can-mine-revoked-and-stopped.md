# "Can mine" for revoked and stopped miners

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling (one question at a time, each with a recommended answer; every recommendation was taken)
- **Research:** `packages/originality/fixtures/README.md` (miner statuses found while recording the fixture); `src/PodMining.sol` (verified, sealed)
- **Supersedes:** decision 2 of `2026-11-20-verdict-scope-and-earliest-design.md` (the list of "Can mine" states). The rest of that record stands.
- **Changes:** the `can-mine` fact in `docs/data-contract.md` (still provisional)

## Context

Decision 2 of the verdict-scope record gave every checked circuit a "Can mine" fact: mining now, can't mine (processor not eligible, uses REF records), or could mine: not started. Recording the fixture showed that the mining contract has two more miner statuses:

| Status | Meaning in `PodMining.sol` | Example |
| --- | --- | --- |
| 2, revoked | `challenge` proved with one of the task's own test vectors that the circuit gives a wrong answer. Its weight is removed, and `start` refuses it for good. Emits `Revoked(bytes32 indexed key, address indexed challenger, uint32 vectorIndex)` | `0x1f5c…/1965` |
| 3, cooling | The owner called `stop`. It earns nothing. `start` accepts it again once `STOP_COOLDOWN` (1,200 blocks) has passed since `stopBlock`. The status stays 3 until someone restarts it. During the 1,200 blocks it can still be challenged. Emits `Stopped(bytes32 indexed key, address indexed by)` | `0x1f5c…/128` |

## Decisions

### 1. Revoked: "Can't mine: failed a test vector"

*Options:* a third "Can't mine" reason with its evidence; "Can't mine: revoked"; a separate warning.

A revoked miner reads **"Can't mine: failed test vector #N of task T (block B). The mining contract won't let it start again."** The vector index and block come from its `Revoked` event, and the task from `getMiner`, so anyone can re-check it. The wording states the fact and nothing about intent. Its estimated value needs no change: its weight is zero, and the valuation reads the weight.

### 2. Cooling: "Not mining: stopped", with when it can start again

*Options:* a fourth state with the stop block; the same as "not started"; "Mining now" with a note.

A cooling miner reads **"Not mining: stopped by its owner at block B; can start again"** once 1,200 blocks have passed since the stop, and **"…; can start again from block B + 1,200"** before that. B is `getMiner`'s `stopBlock`, re-checkable against the `Stopped` event. It never promises that a restart will pass the task.

## The "Can mine" states

Every checked circuit carries exactly one:

| State | When |
| --- | --- |
| **Mining now** | Status 1, active |
| **Can't mine: processor isn't eligible** | The processor's multiplier is 0 |
| **Can't mine: uses REF records** | The netlist has at least one REF record |
| **Can't mine: failed a test vector** | Status 2, revoked (decision 1) |
| **Not mining: stopped** | Status 3, cooling (decision 2) |
| **Could mine: not started** | Status 0 and nothing above rules it out |

When more than one "Can't mine" reason applies, all of them are shown.

## Consequences

- `docs/data-contract.md`: the `can-mine` fact gains `failed-test-vector` (task, vector index, block) and the state `stopped` (stop block, block from which it can start again).
- `CLAUDE.md`: the "Can mine" definition and the "Can mine" row in "Tests that are not optional" list every state.
- The fixture records the `Revoked` and `Stopped` events for its revoked and cooling miners, as one-block reads.
