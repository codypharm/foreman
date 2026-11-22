# The publish job publishes the stored results

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-publish-job.md` (decision 4, the plan file), `2026-11-21-stored-results.md` ("The publish job will read this table")

## Context

The stored-results decision said the publish job would read the results table, so a page and a published result can't disagree. Until 22 Nov 2026 the dry run still built every result itself, from the index and the archive node.

The plan file required every entry to be read at one index block. The stored results share one block only right after the hourly full rebuild. The 5-minute rebuild refreshes only what the follow touched, so between full rebuilds the table mixes blocks. Every result already carries its own index block, in its JSON and in the results contract.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Allow mixed blocks** | A change found by the 5-minute rebuild can be published at once | A plan no longer has one block |
| B | Only after a full rebuild | One block per plan | A change waits for the next full rebuild |

## Decision

**A**, chosen by William in a grilling on 22 Nov 2026.

- **The dry run takes the stored results.** For every miner and every listed circuit that isn't a miner (the same circuits as before), it takes the stored result as stored. It builds nothing and needs no BNB node. A circuit with no stored result is skipped, with "no stored result yet: run the results job", and is never published. A stored result whose circuit is no longer a miner or listed isn't published.
- **Mixed blocks.** Each entry keeps its own index block, which goes on chain with it. The plan file's `indexBlock` is the newest among the results and names the file. Reading a plan refuses an entry newer than that block. The dry run prints the oldest and newest blocks.
- **Unchanged:** what counts as a change (the fingerprint), the batches, `--send` and `--recover`.
