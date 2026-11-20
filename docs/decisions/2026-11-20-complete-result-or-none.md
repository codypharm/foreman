# A result is complete, or there is none

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, one question with a recommended answer (the recommendation was taken)
- **Builds on:** `2026-11-20-originality-result.md`, `2026-11-20-can-mine-revoked-and-stopped.md`
- **Changes:** a note under `Originality` in `docs/data-contract.md`; no shape changes

## Context

Joining the verdict, its facts and the mining contract's answers into one `Originality` showed two cases the contract can't hold:

- **A circuit outside the index.** `Originality.circuit` is a `CircuitRef`, which needs the circuit's tape-out position and time. A circuit the index doesn't hold has neither.
- **A failed mining contract read.** Every result carries exactly one can-mine fact. Without the read there is none to give.

## Decision

*Options:* return an error and no result; widen the contract so a result can lack these parts.

**A result is built whole or not at all.** Both cases are an error for the caller, never a partial `Originality`:

- A circuit outside the index: **"Can't check: outside the index, up to block B"**.
- A failed mining contract read: **"Can't check right now: the chain read failed"**.

Neither is published. Widening the contract would make every reader handle missing parts, and a partial result could reach X Layer.

## What stays

- **`cant-check` with `outside-index`** remains a verdict for a circuit that *is* indexed but whose wrapper or REF targets are not. That gives a complete result.
- **An unreadable netlist** still gets a complete result, "Can't check: netlist unreadable". The index holds every tape-out, readable or not, so its `CircuitRef` exists.

## Consequences

- `packages/originality`: `buildOriginality` refuses to build without exactly one can-mine fact.
- `packages/index`: `readCircuitRef` gives any indexed circuit's `CircuitRef`, and `null` outside the index.
- The API turns these cases into a clear "Can't check" error, never a crash, a blank or a silent "no copy" (`CLAUDE.md`, "Bad input").
