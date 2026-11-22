# The follow lists the processors in Multicall3 bundles

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-20-circuit-index.md` (decision 2, the count check), `2026-11-22-market-reads-multicall.md` (the contract, confirmed), `2026-11-22-results-reads-multicall.md`

## Context

Every follow lists every processor the factory knows (`cpuAt(i)`) and reads how many ids each has issued (`nextId()`), at the follow's block. It uses those counts for the count check and to pick which processors' tape-outs to read. There were 1,496 processors on 22 Nov 2026. The follow read them 25 at a time, two round trips each group, and spent about 130 of its 170 s there. The results-reads decision noted this could be bundled; William chose to do it ("Bundle the follow").

## How

**Explicit bundles in the tape-out scan, not bundling on the follow's whole client.** Bundling on the client, as the results job does, would also bundle the follow's netlist reads. Those are heavy, and a read starved of gas inside a bundle comes back as a failure, so it isn't safe to send them that way. Only the two processor reads are bundled.

- **Bundles:** all `cpuAt` reads first, then all `nextId` reads. Each phase goes in Multicall3 bundles of 250 processors, 4 bundles at a time, at the follow's block, at the confirmed address `0xca11bde05977b3631167028862be2a173976ca11`. That's about 12 calls in place of about 3,000.
- **A failed read stops the scan.** Neither read can revert for a listed processor, so a read that fails inside its bundle fails the scan with "read-failed", naming the read. A processor is never dropped. The next follow tries again.
- **The replay answers bundles.** In tests, a Multicall3 bundle that wasn't recorded whole is answered from the recorded single reads inside it, at the same block, as the contract would. A bundle holding any unrecorded read throws. The market scan's "the bundled read fails" test now breaks the recorded bundle's answer, so it can't be decoded, rather than removing it.
- **Tests:** the scan lists its processors in bundles, with no call to any processor and only `cpuCount` to the factory. A `nextId` that fails inside its bundle stops the scan and names the processor. The earlier tape-out, follow and store tests pass unchanged.

## What follows

- **Measured on 22 Nov 2026:** the first live follow with bundles listed all 1,496 processors in about 5 s, down from about 131 s. The whole follow, which caught up 60,000 blocks (to block 135,135,809) and read 28 tape-outs, 7 miner starts and the market, took 51 s, down from 170 s.
