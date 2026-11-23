# The read-back says when a published verdict still holds

- **Date:** 23 November 2026
- **Status:** Accepted
- **Decided by:** William, 23 Nov 2026: "Same verdict ✓" over a wording-only change, then direction B of `docs/mocks/2026-11-23-readback-same-verdict.html`
- **Builds on:** `2026-11-23-read-back.md` (decision 2, the checklist), `2026-11-21-publish-job.md` (decision 6, what counts as a change)
- **Changes the data contract:** `Published`, its `older` state (decision 2 below)

## Context

A circuit is published again only when its verdict, the evidence for it or its can-mine state changes (publish-job ADR, decision 6). A later index block or a larger circuit count isn't a change. So most published results were read at an earlier block than the page's, and their bytes differ from the page's result even though the verdict is the same.

The read-back's third check compared the whole result. On 23 Nov 2026, circuit #2893 was published on 21 Nov as a copy of circuit #88, from BNB block 134,712,080 against 80,290 circuits, and its page showed the same copy at block 135,273,897 against 80,409. The panel crossed it out: "Differs from this page. This page shows a newer check that isn't published yet." Above it: "From an earlier check; this result isn't published yet." Both say more than was checked, and wrongly suggest something is missing.

## Decisions

1. **The read-back compares what decides a publish.** The browser computes the change fingerprint of the result it read from X Layer and of the result on the page, with the same function the publish job uses (`changeFingerprint`, moved to `@foreman/chain-xlayer/results` so the web app loads it). It still takes nothing from Foreman's API for this check.
   - **Byte-identical:** ✓ "Same as this page", as before.
   - **Same fingerprint, different bytes:** ✓ "Same verdict and evidence as this page", naming the verdict, the netlist hash and the can-mine state. Then a neutral grey dot, neither tick nor cross, "Checked again since": the block and circuit count it was published from and the page's, and that a newer check with the same verdict isn't published again.
   - **Different fingerprint:** ✗ "The verdict changed since", naming the published verdict and the page's, and that the worker publishes the new one within 5 minutes.
2. **`Published`'s `older` state carries `verdict: "same" | "changed"`**, from the fingerprint Foreman stored with its last publish against the stored result's. The panel's line before any read-back uses it:
   - `same`: the verdict line, then "published from an earlier check";
   - `changed`: "From an earlier check; the new verdict isn't published yet".

## Consequences

- A tick still covers only what was compared: verdict, evidence and can-mine state. The newer block and count are stated as facts beside it, never ticked.
- The fingerprint function has one home, shared by the publish job, the API and the browser, so the three can't disagree about what counts as a change.
