# Every result is published once more in the amended shape

- **Date:** 25 November 2026
- **Status:** Accepted
- **Decided by:** William, from two options
- **Extends:** `2026-11-21-publish-job.md` (decision 6, what counts as a change) and `2026-11-25-fabx-copy-check.md` (the amended `Originality`). Neither is edited

## Context

`2026-11-25-fabx-copy-check.md` amends `Originality`: it gains `mining`, and `index.upToBlock` (one chain) becomes `index.upTo` (one entry per chain). On 25 November 2026, 26,741 results were already published on the X Layer testnet in the earlier shape. `parseOriginality` reads only the amended one, so the result page's Published panel couldn't read those results back.

A circuit is published again only when its verdict, evidence or can-mine state changes (`2026-11-21-publish-job.md`, decision 6). The new shape alone wouldn't trigger a publish.

## Decision

1. **Every result is published once more, in the amended shape.** The change fingerprint gains a shape number, 2. Every fingerprint stored before it differs, so the next publish run publishes every result again. After that, decision 6 of the publish job applies unchanged. A new rule version alone still isn't a change.
2. **Old logs stay as they are.** Each earlier `Published` event remains on chain as history. The panel reads a circuit's latest publish.
3. **Until a circuit's turn comes,** its Published panel says its last publish is in the earlier format and will be published again, rather than "isn't one the data contract can read".
4. **Cost:** testnet gas only. About 340 transactions at the 131,072-byte limit per transaction.

*Rejected:* a parser that also reads the earlier shape. The earlier JSON never stated the mining contract, so for a listed circuit Foreman would have to guess whether it was a miner, or `Originality` would gain a "not stated" value.

## Consequences

- The republish runs on the worker's normal schedule, after the amended contract and the cross-chain check are deployed.
- The publisher wallet needs enough testnet OKB for about 340 transactions. `GET /health` warns below 0.05 OKB.
