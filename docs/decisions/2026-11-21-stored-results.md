# Stored results: which circuits, and when they're rebuilt

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-api-endpoints.md` (decision 2: originality stored by a job)
- **Changes:** the last sentence of that decision 2 ("A circuit with no stored result is 'Can't check'") for pasted circuits

## Context

The API reads results from a table that a job fills. On 21 Nov 2026, the existing builder (`apps/api/src/result.ts`) was timed against the local index at block 134,895,911. It took 2,000 results in 15 seconds at 200 at a time, about 7 ms each, almost all of it archive-node reads. At that rate:

- the 26,715 miners and listed circuits take about 3.3 minutes;
- all 80,305 indexed circuits take about 10 minutes.

So a full rebuild can't run every 5 minutes. The follow sees new tape-outs, netlists, miner starts and commitments, revokes and listings. It doesn't see a miner stopping, or a cooling miner becoming able to start again: both only show in `getMiner`, which the builder reads.

## Decision

Settled by a grilling on 21 Nov 2026.

1. **The table holds miners and listed circuits.** That's the 26,715 that the listings page, wallets and the publish job need. A circuit that is neither is built on request for its page, with `scope: "pasted"`, and is never stored or published. "Can't check" stays the answer when a result can't be built.
2. **Changes after every follow, and everything every hour.**
   - **After each 5-minute follow,** rebuild every miner or listed circuit touched since the last rebuild, together with every circuit sharing a touched circuit's netlist hash. Touched means one of:
     - a new tape-out;
     - a netlist or design commitment read;
     - a miner start;
     - a revoke;
     - a new listing.

     Also rebuild any miner or listed circuit that has no row yet. When a listing closes and its circuit isn't a miner, its row goes.
   - **Every hour,** rebuild all of them. This catches what the follow can't see: stops, restarts, and counts such as "miners using this design".

   A new listing is checked within 5 minutes, and a stop shows within an hour.

## What follows

- **Every row keeps its index block,** and the page shows it, so an older row is labelled as older, never passed off as fresh.
- **A failed build keeps the circuit's last complete row,** with its own older block, and the failure is logged. A circuit with no complete row is "Can't check". A result is still whole or none (`2026-11-20-complete-result-or-none.md`).
- **The publish job will read this table** instead of building its own results, so a page and a published result can't disagree. That change comes after the table works.
- **Revisit** if the hourly rebuild's load on the archive node is too much once hosted.
