# The publish job

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William, six questions one at a time, each with a recommended answer (every recommendation was taken)
- **Builds on:** `2026-11-21-results-contract.md` (the contract, what is published, what counts as a change), `2026-11-18-api-and-jobs.md` (Hono, Postgres, pg-boss), `2026-11-20-database-access.md` (`pg`, numbered migrations)
- **Adds to:** decision 2 of `2026-11-21-results-contract.md`, on what counts as a can-mine change (decision 6 below)

## Context

The results contract is built and not yet deployed. The publish job builds a result for every miner and every listed circuit, works out what changed since the last publish, and sends the changes to the contract in batches, signed with a publisher key William provides at run time. Hosting is not chosen, and `apps/api` doesn't exist yet.

## Decision

1. **A command William runs.** The job is its own entry point in a new `apps/api` (`pnpm --filter @foreman/api publish-results`), with no Hono server and nothing scheduled yet. The publisher key is read from the environment of that run only. It moves onto pg-boss once hosting is chosen.
   *Rejected:* a pg-boss job now (the key would have to live on a host nobody has chosen); a script in `scripts/` (outside the workspace, nothing reuses it).
2. **A table of what was published, checked against the chain.** A Postgres table, in `packages/index`'s migrations, holds one row per circuit per results contract: the kind, the can-mine state, the change fingerprint (decision 6), the result hash, the index block, and the transaction and block it was published in. A row is written only after its transaction confirms. Each `--send` run first reads the contract's `resultOf` for every circuit in its plan and stops if any stored hash differs from the table (a missing row must read as never published). A batch that landed without being recorded is caught there.
   *Rejected:* the table alone (a lost or edited database would quietly republish or skip circuits); the chain alone (rebuilding from `Published` events means thousands of 100-block log reads on X Layer's public RPC every run).
3. **Chain reads in JSON-RPC batches.** The can-mine reads (about 20,850 miners, 2 to 3 calls each) go to the BNB archive node as batched JSON-RPC requests, every call pinned to the index's block. No new contract address is used.
   *Rejected:* Multicall3 (an address not in On-chain facts, to be confirmed first); one call at a time (about 50,000 requests, likely hours, more exposed to rate limits).
4. **A dry run unless `--send`.** Without `--send` the command builds every result, works out what changed, and writes the plan to a file: every entry with its JSON and hash, counts by verdict and estimated gas. It needs no key. `--send` takes that plan file and sends exactly it, after the on-chain check in decision 2.
   *Rejected:* always sending (the first look at what is published would be on chain); a prompt per batch (about 210 prompts on the first publish).
5. **Stop at the first failure.** One batch at a time, each waiting for its receipt. A revert, a timeout or a failed RPC call stops the run and reports the batch and the error. Nothing is retried or skipped inside a run. The next run starts again from the table and the on-chain check.
   *Rejected:* retry then skip (a run can end with gaps that are easy to miss); sending every batch without waiting (nonce and partial-failure handling).
6. **What counts as a change, made exact.** A circuit is published again when any of these differs from its last publish: the verdict kind; the evidence for that kind (the earlier circuit of a copy or a too-small-to-tell, the targets and chain ends of a wrapper, the netlist hash, the reason of a can't check); the can-mine state; or, for "can't mine", the set of reasons. A stopped miner whose stop block moved, a new index block or a changed count is not a change. These go into one fingerprint, a hash stored in the table.
   *Rejected:* the can-mine state only (a miner revoked on top of an ineligible processor would keep its old reasons on chain); any can-mine detail (the stop block alone would trigger publishes).

## What follows from these

- **Which circuits:** every miner in the index (`scope: "miner"`) and every circuit with an open listing on TapeOut's circuit market that is not a miner (`scope: "listed"`). Complete results only. A "Can't check" error (outside the index, a failed read) is reported and skipped, never published (`2026-11-20-complete-result-or-none.md`).
- **One block per run:** results are built from the index at its `upToBlock`, and the can-mine reads are pinned to that block, so every result in a run says the same block.
- **The contract address** is a constant in code per chain (196 and 1952), filled in only once William has deployed and the address is in On-chain facts. Until then `--send` refuses both chains. Tests deploy `ForemanResults` to a local copy of X Layer.
- **The key** is never logged, written to the plan file or stored. The command logs circuit ids, miner keys, the publisher address and transaction hashes only.
- **Batch size:** measured on the testnet, as `2026-11-21-results-contract.md` says. The plan's gas estimate is checked against the testnet's real figures.

## Consequences

- **`apps/api`** starts here, with the publish command only.
- **`packages/index`** gets the published-results table and its read and write functions.
- **The "Published result" test** (CLAUDE.md): a result written to a local copy of X Layer decodes back from the log to the same verdict, evidence, rule version and block, and its short verdict agrees. Further tests: an unchanged circuit is not in the plan, each change in decision 6 is, the on-chain check stops on a mismatch, and a failed batch records nothing.
- **Not decided here:** hosting, and when the command moves onto a schedule.
