# Publishing FabX results

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, one question with a recommended answer and its alternative (decision 1). Decisions 2 and 3 apply `2026-11-25-fabx-copy-check.md`, decisions 6 and 7
- **Extends:** `2026-11-25-fabx-copy-check.md` and `2026-11-21-publish-job.md`. Neither is edited

## Context

The results job stores every FabX miner's result (`2026-11-26-fabx-follow.md`). FabX's `ProcessorSet` history has been read in full (On-chain facts, 25 November 2026), so decision 9 of the FabX ADR no longer holds publishing back. Measured on 26 November 2026: about 7,145 FabX results, about 72 transactions and 0.012 OKB to publish once (a batch of 76 results cost 0.00013 OKB), with 1.13 OKB in the testnet publisher.

A published result stays on chain as a fact at its block. FabX's go/no-go is 1 December, and no FabX result has been checked on screen yet.

## Decisions

### 1. FabX results are published only when `PUBLISH_FABX=1`

The worker and the publish command publish FabX results only while `PUBLISH_FABX=1` is set. It is off by default. William turns it on after checking FabX results on the page, or at the go/no-go. BNB Chain publishing doesn't change.

*Rejected:* publishing with the first worker run after deploy, before anyone has looked at a FabX result.

### 2. A key planned twice stops the publish

A plan in which one key appears twice fails, and nothing is sent. Keys are `keccak256(processor, circuitId)`, and every run plans every stored result from both chains, so a FabX circuit sharing a key with a BNB Chain circuit always shows up this way.

### 3. Nothing is published for FabX while it is frozen

Results already published stay valid as facts at their block.

## Consequences

- `PUBLISH_FABX` joins the worker's variables in `.env.example`. Nothing is set on Railway until William chooses to.
