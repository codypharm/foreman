# The results job's reads go in Multicall3 bundles

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-stored-results.md`, `2026-11-22-market-reads-multicall.md` (the contract, confirmed and in "On-chain facts")

## Context

Each result needs two chain reads at the index block: the miner (`getMiner`) and its processor's multiplier (`processorMultiplier`). The netlists and everything else come from the database. A full rebuild on 22 Nov 2026 covered 26,726 circuits, about 53,000 reads, sent in JSON-RPC batches. It reached 8,000 circuits in about 14 minutes, so a whole rebuild would take about 50 minutes. The hourly full rebuild can't take most of an hour.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **viem's own bundling, on the results job's client** | No change to the code that reads. Reads made together at one block go in one `aggregate3` call | Each result's reads travel with about 100 others |
| B | Explicit bundles in the results job, as the market scan does | Each bundle visible in the code | Rewrites the can-mine read, which the circuit page shares |

## Decision

**A**, chosen by William ("Yes, bundle them").

- **The client:** `bnbClient({ multicall: true })` bundles reads made within 16 ms at one block into one Multicall3 call of up to 4 kB of call data, about 100 reads. The chain is pinned to Multicall3 at its confirmed address, `0xca11bde05977b3631167028862be2a173976ca11`, so viem never takes the address from anywhere else. Only the results job turns it on. The follow, the market scan and the API keep their clients as they were.
- **A failed read is never a verdict.** Inside a bundle, viem fails just that read, and the result builder already treats any failed read as "read failed": the circuit is skipped and tried again on the next run, never stored. Both reads are small views, so a read starved of gas inside a bundle isn't a real risk. If one were, it would still be a skip.
- **Tests:** the replay client takes `{ multicall: true }` and answers each bundle from the recorded single reads inside it, at the same block, as the contract would. A bundle holding any read that was never recorded fails. Without the option, a bundle is answered only when it was recorded whole, so the market scan's tests still see a failed bundle. A full rebuild of the fixture's 17 results through bundles stores the same rows as one by one.

## What follows

- The first full rebuild with bundles gives the real time. Revisit if it is still more than a few minutes.
- The follow's 1,496 processor `nextId` reads (about 130 s of its 2:50) could be bundled the same way. That's a separate choice.
