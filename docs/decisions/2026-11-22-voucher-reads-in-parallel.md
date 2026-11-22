# The voucher lookup reads the vouchers in parallel

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-20-lend-from-tapepool.md`, `2026-11-21-circuit-page-reads.md`

## Context

The RIG voucher has no lookup by miner. To find a miner's voucher, the circuit page reads every voucher's id (`tokenByIndex`) and its miner (`rigs`) until one matches. It read them one at a time on X Layer's public node. On 22 Nov 2026 there were 16 vouchers, and the lookup took 14.9 s of a 17 s circuit page. The BNB reads took 1.5 s, X Layer's head 0.9 s and Lend 0.4 s.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Read in parallel** | About two round trips. A small change in `chain-xlayer`, no new contract | Grows slowly with the number of vouchers |
| B | Cache the voucher list in the server | Near-instant pages | A newly bridged voucher shows up to a few minutes late; more to get right |
| C | Multicall3 on X Layer | One call | Its address on X Layer isn't confirmed or listed in "On-chain facts" |

## Decision

**A**, chosen by William.

- **8 at a time** (`VOUCHER_READS_AT_ONCE`). Each worker reads one voucher's id, then its miner, and takes the next. X Layer's public node takes one request per read here and refuses bursts. 8 stays well inside what it served.
- **A failed read fails the lookup.** A voucher that couldn't be read is never taken for "no voucher". viem's own retries run first.
- **Measured on 22 Nov 2026** against the local API: circuit pages went from 16.4–17.6 s to 4.9–6.4 s, with the same content. A miner with a voucher (#19, circuit `0xb102…a14c`/12814) shows the voucher, its holder and Lend "not deposited".

## What follows

- The two fork fixtures were recorded with the old lookup, which stopped at the match. The parallel lookup reads a few vouchers past it, so the voucher-list reads were added from X Layer mainnet at each fork's starting block. The fork only moved vouchers between wallets, which changes neither read, and the 18 reads the fixtures already held match mainnet exactly. Each fixture says so in `voucherListFrom`.
- The rest of a page's 5 s is BNB reads, X Layer's head and two rounds of voucher reads. Revisit with B if pages need to be faster for the demo.
