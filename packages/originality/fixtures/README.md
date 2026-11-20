# Originality fixtures

`bnb-circuits-134673279.json` holds saved JSON-RPC responses for 33 real BNB Chain circuits: 30 chosen and 3 reached through their REF records. Tests replay it with `replayClient` from `@foreman/chain-bnb/fixture`, which answers only recorded calls and refuses any other, so a test never reaches the network. It was recorded on 20 November 2026 by `scripts/record-fixture.ts`. Read only; the endpoint and its key are not in the file.

## The tape-out scan: `bnb-tape-outs-116150000.json`

Recorded on 20 November 2026 by `scripts/record-scan-fixture.ts` (`pnpm --filter @foreman/originality record:scan`), for `scanTapeOuts` (`docs/decisions/2026-11-20-circuit-index.md`, decision 2). It covers blocks 116,042,002 (the factory's first block with code) to 116,150,000:

| Call | What it gives |
| --- | --- |
| `cpuCount()` and `cpuAt(i)` on the factory, at block 116,150,000 | 32 processors |
| `nextId()` on each, at block 116,150,000 | 95 circuits in all, on 6 processors; the other 26 had none |
| `eth_getLogs` for `TapedOut` with no address filter, in three reads of 50,000 blocks or fewer | 95 events, all from listed processors, each count equal to its `nextId()` |

| Processor | Tape-outs |
| --- | --- |
| `MINE6` (`0x1f5c…`) | 67 |
| `0xb102…` (multiplier 1) | 18 |
| `P0` (`0x50a9…`) | 6; `/1` is the first tape-out, block 116,070,652, transaction 27, log 114, by `0x571d…af15` |
| `0xd89b…` | 2 |
| `0xbfc8…`, `0x592b…` | 1 each |

There is no look-alike event in this range; the test adds one (`withTapeOutLog` in `src/testing.ts`). The count-check tests remove events (`withoutTapeOutLog`).

## What is recorded, per circuit

| Call | Pinned to |
| --- | --- |
| `netlist(id)`, `circuitInfo(id)` on the processor | block 134,673,279 |
| `processorMultiplier(processor)`, `getMiner(minerKey)` on the mining contract | block 134,673,279 |
| `eth_getLogs` for its `TapedOut` event, and `eth_getBlockByNumber` for the time | the tape-out block (one block) |
| `eth_getLogs` for `DesignCommitted`, when `getMiner` has a `commitBlock` | the commitment block (one block) |
| `eth_getLogs` for `Revoked` (revoked miner) or `Stopped` (cooling miner) | the block it happened in (one block); a revoke block was found by searching from the tape-out |

Tape-out events are read one block at a time because the recorder found each block first. The index reads them differently (next section), so a test that needs a different log read means re-recording.

**`nextId()` returns the last id issued, not the next one.** It read 6,534 before `0x50a9…/6535` was taped out and 6,535 after, and PodMining sets `firstUnusedId = nextId() + 1`. TAP-02 says otherwise.

## Processors

| Short | Address | Can mine |
| --- | --- | --- |
| `P0` | `0x50a994e71615474b55559ff4f500928fbc339dd9` (processor 0) | No (multiplier 0) |
| `MINE6` | `0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c` | Yes, multiplier 6 |
| `WRAPS` | `0xc1ae0d87cde4f93bcae38c6d62a269c76d5d3215` (120 pure wrappers of `MINE6/512`) | No |
| `0x5484…` | `0x54840f62c9d6cf322a3972a6be0be16e76077cc0` | No |
| `0xd3c3…` | `0xd3c3a93ca6cacc50b303cac1e51580cd95632509` | No |
| `0xf441…` | `0xf4412c52ec3ddf7caf5f518b6662f77b02bde28e` | No (set to 0) |

## Cases

"Tape-out" is (block, transaction index, log index). "Identical" means the same `nIn`, `nOut` and bytes once each NAND's two inputs are sorted. These are the facts the tests check against; the expected verdicts follow from the rules in `docs/decisions/2026-11-20-copy-and-wrapper-rules.md` and `2026-11-20-verdict-scope-and-earliest-design.md`.

### Wrappers and REF

| Circuit | What it is | Covers |
| --- | --- | --- |
| `P0/6534` | 34 bytes, one REF to `P0/5388` (1 NAND) | Pure wrapper; can't mine: processor not eligible |
| `MINE6/38` | 79 bytes, one REF to `P0/1` (1,204 gates); `circuitInfo` reports 1,204 gates | Pure wrapper on a processor that can mine; can't mine: uses REF records |
| `WRAPS/106`, `WRAPS/109` | Identical 31-byte wrappers of `MINE6/512`, same address, **same block and transaction** (124,105,968, tx 44), log index 237 and 246 | Same-block tie decided by log index; wrapper with an "also identical" fact |
| `MINE6/42` | Wrapper of `MINE6/3`, which has gates of its own | A chain that stops at the first circuit with its own gates (one step) |
| `MINE6/68` | 3,968 bytes, several REF records, all to `MINE6/1` | Pure wrapper made of many REF records |
| `MINE6/3` | 176 NANDs and 2 REFs to `P0/1` | REF records mixed with real gates: the "uses REF" fact, not a wrapper; can't mine: uses REF records |

**Not found on chain:** a wrapper of a wrapper (A → B → C with B a pure wrapper). The 191 pure wrappers on `MINE6` and `WRAPS` all point to circuits with gates of their own. The chain-following test builds its two-step case from these real records and says so.

### Identical circuits

| Group | Circuits, earliest first | Covers |
| --- | --- | --- |
| 1,204 gates, 8,428 bytes | `P0/1` (116,070,652), `0x5484…/1` (116,404,503), `0xd3c3…/3` (121,905,934): three different addresses, none a miner | Copy across processors; earliest is not a copy; different-address fact |
| 3 gates, 21 bytes | `P0/42`, `/189`, `/406`, `/1251`; the last three from one address | Too small to tell; same-address fact |
| 1 gate, 7 bytes | `MINE6/46` (active miner, 116,142,423), `P0/5388` (123,718,510) | A tiny miner whose identical circuit came later; too small to tell |
| 603 gates, 4,221 bytes | `0xf441…/63` (117,236,264, processor can't mine), then miners `MINE6/1008`, `/1144`, `/1147`; the last two from one address | **Miners copied from a circuit that can't mine**: the case the contract can't see. Same-address and different-address facts |

### Swapped NAND inputs

| Group | Circuits | Covers |
| --- | --- | --- |
| 31 gates, 217 bytes | `MINE6/967` (taped out 117,434,333, commitment 117,434,328); `MINE6/1784` and `/2397` have the same bytes as each other, and differ from `/967` only in input order | Copies found only once inputs are sorted (`bytesIdentical: false`) |
| 29 gates, 203 bytes | `MINE6/1510` (taped out 118,019,547, commitment 118,019,152); `MINE6/1570` (taped out **later** at 118,044,136, commitment **earlier** at 117,659,567). Bytes differ only in input order | Swapped inputs **and** a commitment deciding which is earlier: `/1570` is the earlier design |

### Design commitments

| Group | Circuits | Covers |
| --- | --- | --- |
| 119 gates, 833 bytes | `MINE6/2510`: taped out 122,747,227, commitment 122,730,917. `MINE6/2683`: taped out **5 million blocks later** at 127,718,339, commitment **earlier** at 122,268,369; holds the design bonus | The earliest proven design is the original: `/2683` is earlier, so `/2510` is the copy despite its lower id and earlier tape-out |

### No identical circuit, and miner status

| Circuit | Status in `getMiner` | Covers |
| --- | --- | --- |
| `MINE6/153` | 1, active | No identical circuit among the circuits on `MINE6` (scanned 20 Nov). In the fixture it is "No earlier copy found among 33 circuits" |
| `MINE6/1` | 1, active (963 gates, 47 LATCHes) | An ordinary miner with LATCHes, reached as a REF target |
| `MINE6/512` | 1, active, commitment 117,250,897 | A miner with a commitment, reached as a REF target |
| `MINE6/1231` | 0, never started; no REF | Could mine: not started |
| `MINE6/1965` | 2, **revoked** at block 118,590,677: failed test vector #140 of task 260; weight 0 | Can't mine: failed a test vector |
| `MINE6/128` | 3, **cooling**: stopped by its owner at block 129,714,987 (task 4); the 1,200 blocks have passed | Not mining: stopped; can start again |

The "Can mine" states and their wording: `docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md`.
