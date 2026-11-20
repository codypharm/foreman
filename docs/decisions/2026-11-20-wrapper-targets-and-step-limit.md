# Wrapper targets and the chain step limit

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling (one question at a time, each with a recommended answer; every recommendation was taken)
- **Adds to:** decision 6 of `2026-11-20-copy-and-wrapper-rules.md` (wrapper chains: name the direct and the final target), which stands
- **Changes:** the `wrapper` verdict in `docs/data-contract.md` (still provisional)

## Context

Decision 6 names a wrapper's direct target and the circuit at the end of the chain that holds the gates, "up to a stated step limit". It left two things open:

- **A pure wrapper can have REF records pointing to several different circuits.** The data contract's `wrapper` verdict had a single `finalTarget`. None of the 191 pure wrappers read on 20 November (71 on `0x1f5c…f12c`, 120 on `0xc1ae…3215`) has more than one distinct target, but most processors have not been read yet.
- **The step limit had no number.** REF chains can't loop, because a REF can only name a circuit that already exists (TAP-02 §3). The longest chain found so far is one step (`0x1f5c…/42` → `0x1f5c…/3`).

## Decisions

### 1. List every target and where each chain ends

*Options:* list every target and end; "Can't check"; name the first target only.

A pure wrapper names **every distinct circuit its REF records point to**, and **every circuit where a chain ends** (the first circuit with gates of its own). For example: "Wrapper of #A and #B: the gates are in #A and #C." In the data contract, `finalTarget` becomes `finalTargets`. A wrapper with one target reads as before.

### 2. A 10-step limit, on the longest branch

*Options:* 10, 5 or 32 steps.

Foreman follows each REF chain for at most **10 steps**, one netlist read per step. With several targets the limit applies to the longest branch. Past the limit, the verdict is **"Can't check"** (`ref-chain-too-long`). The limit is stated on screen and carried in the rule version.

## Consequences

- `docs/data-contract.md`: `{ verdict: "wrapper"; pointsTo: CircuitRef[]; finalTargets: CircuitRef[]; chainSteps: number }`, where `chainSteps` counts the longest branch.
- **Tests:** a wrapper with one target, a chain that stops at a circuit with its own gates, many REF records to one target, a chain past the limit, and an unreadable target. A multi-target wrapper is built from real records, since none has been found on chain.
