# FabX's history on X Layer

*Read on 25 November 2026 by `pnpm --filter @foreman/chain-xlayer backfill:fabx-logs`: every log from FabX's processor (`0x87bf…f9a6`) and FabX's mining contract (`0x4f6a…8265`) from X Layer block 73,042,958 to 76,847,895, in 38,050 reads of 100 blocks on the three public nodes, at about 11 reads a second. The output, `data/fabx-logs-76847895.jsonl` (262 MB), isn't committed; the script reads it again. Follows `2026-11-25-fabx-on-x-layer.md`. Decisions: `2026-11-25-fabx-copy-check.md`, `2026-11-25-fabx-storage.md`.*

## The read is complete

| Check | Result |
| --- | --- |
| `TapedOut` events from FabX's processor | 7,164 |
| The processor's `nextId()` at block 76,847,895 | 7,164 |
| A known tape-out, #24 | Found, at block 73,044,971 |

Logs read, by contract and event: the processor's 7,164 `TapedOut` and 14,543 `Transfer`; the mining contract's 12,665 `DesignCommitted`, 3 `ProcessorSet`, 36 `Upgraded`, 1 `OwnershipTransferred`, 2 `BoostSet`, 231,813 `Claimed` and other events not interpreted here.

## Eligible processors: the full `ProcessorSet` history

| Block | Time (UTC) | Processor | Multiplier |
| --- | --- | --- | --- |
| 73,100,862 | 13 Oct 05:38 | `0x265e2580cb9c3fc059f2aa3cf20ad30f3f0a653c` | 1 |
| 73,101,256 | 13 Oct 05:44 | `0x265e…653c` | 0 |
| 73,101,384 | 13 Oct 05:47 | `0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6`, FabX's processor | 6 |

**Today only FabX's processor is eligible.** `processorMultiplier` reads 0 for `0x265e…653c` at the head.

**`0x265e…653c`** was eligible for 394 blocks, before mining started (`startTime`, 13 Oct 12:02).

- Its `factory()` is `0x82935793a854fa2f2e8a9d2b3f17bbfbf81d6c05`, not TapeOut's X Layer factory. It has issued 100 circuits.
- While it was eligible, the mining contract emitted 100 events (topic `0x71091468…`) numbered 1 to 100: FabX's tasks, set up against its circuits. Not interpreted further.
- `getMiner` for its circuits #1 to #100 reads status 0 (none). No miner is registered on it.

## Upgrades: 36, the last on 18 October

| When (UTC) | What |
| --- | --- |
| 13 Oct 05:37, block 73,100,842 | Created with implementation `0xe1dd…7cb0`; owner set to `0xfb77…5ef8`, the only `OwnershipTransferred` |
| 13 Oct 05:45 | Implementation `0xb48b…03a5` |
| 13 Oct 12:02 | One transaction: `0xb8ea…4945`, then back to `0xb48b…03a5` |
| 14 Oct 05:20, blocks 73,186,188 to 73,186,222 | 15 transactions, each `0x24d7…8980` then back to `0xb48b…03a5` (the migration below) |
| 16 Oct 11:31 | Implementation `0x98a0…738a` |
| 18 Oct 01:18, block 73,517,253 | Implementation `0x9068…eeb`, today's |

**The current code has been unchanged since block 73,517,253.** It is the version the probe compared with TapeOut's PodMining, and the starting point for the freeze (`2026-11-25-fabx-copy-check.md`, decision 6): an `Upgraded`, `OwnershipTransferred` or `ProcessorSet` after it freezes FabX results.

A temporary implementation that runs and is swapped back in the same transaction can write any storage and emit any event. The 14 October swaps did both, as below.

## The 14 October migration of design commitments

In the 15 swap transactions of 14 October, the mining contract emitted **4,089 `DesignCommitted` events whose block field (73,057,317 to 73,098,004) is earlier than the block they were emitted in**, and earlier than the contract itself (73,100,842).

They come from **an earlier FabX mining contract, `0xb6d4d03e9dfd3ad4889241e23f12ea4557696018`:**

- a 130-byte proxy whose `owner()` is `0xfb77…5ef8`, FabX's owner;
- its logs from 73,042,958 to 73,200,000: 4,159 `DesignCommitted`, 3 `ProcessorSet`, 100 task events, 2 `Upgraded`, 1 `BoostSet`; the last at block 73,199,834.

**All 4,089 migrated events match an original event in that contract:** the same commitment, in the claimed block, with the same designer, processor and data. 70 of its commitments weren't migrated.

**Effect on results.**

- 54 of today's miners have a `commitBlock` from before today's contract existed, all of them migrated.
- For 13 of them (10 at 4 gates or more) the commitment decides which circuit of an identical group is earlier. Up to 54 other circuits' verdicts depend on those 13.

**William's decision, 25 Nov 2026:** decision 5 stays strict. A commitment counts only when today's mining contract emitted its `DesignCommitted` event in the claimed block. The migrated ones don't, so where they decide the order the result is **Can't check** ("commitment-unconfirmed"), about 1% of FabX. The earlier contract is not added to On-chain facts and is not used.

*Not taken:* also accepting the earlier contract's original event in the claimed block. It would give those results real verdicts, at the cost of a new address, a new decision record and one more log read to keep.

## Also seen

- **`BoostSet`** twice, on 13 Oct at 05:45 and 11:42, before mining started.
- **No `Paused` or `Unpaused`** in today's contract.
