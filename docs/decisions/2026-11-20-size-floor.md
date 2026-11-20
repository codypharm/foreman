# Size floor: 4 gates

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, from the measurement below (recommended 4, alternative 11)
- **Settles:** decision 3 of `2026-11-20-copy-and-wrapper-rules.md`, which left the number to be measured from the index
- **Measurement:** `packages/index/scripts/measure-size-floor.ts` (`pnpm --filter @foreman/index measure-floor`), output `data/size-floor-134690552.json`

## Decision

A miner whose netlist is identical to a circuit with an earlier design time is:

- **"Too small to tell"** when it has **fewer than 4 gates** ("Identical to N earlier circuits; too small to tell");
- **"Copy"** when it has **4 gates or more**.

The gate count is the one the processor stores for the circuit (`circuitInfo`). The floor is part of the rule version and is stated on screen beside every copy and "too small to tell" result.

## What was measured

The full index on BNB Chain, up to block 134,690,552:

- 80,290 circuits on every factory-listed processor, every netlist read (none unread, none unreadable);
- 6,681 pure wrappers left out, because they get the wrapper verdict first;
- 73,609 circuits compared;
- 20,900 miners, every design commitment read (7,635 with one).

Circuits are ordered by earliest proven design, as `2026-11-20-verdict-scope-and-earliest-design.md` defines it. For each gate count, the script counts the miners whose netlist hash matches a circuit with an earlier design time, and how many of those match a circuit taped out by a different address.

18,597 of the 20,900 miners match an earlier circuit. 2,303 match none at any floor.

### Small circuits, where matching is expected

| Gates | Miners | Match an earlier circuit | Distinct designs among them |
| --- | --- | --- | --- |
| 1 | 1,596 | 1,576 | 13 |
| 2 | 3,558 | 3,546 | 6 |
| 3 | 2,366 | 2,349 | 15 |
| 4 | 385 | 364 | 21 |
| 5 | 161 | 138 | 18 |
| 6 | 237 | 204 | 28 |
| 10 | 3,203 | 3,169 | 25 |

At 1 to 3 gates, 7,520 miners use 53 designs between them. There are only a few ways to build something that small, so honest designers reach the same netlist without copying. From 4 gates the count of miners drops sharply and the designs spread out. 10 gates is the exception: one 10-gate design is used by 3,021 miners.

### The candidate floors

| Floor | Copy | Copy of a different address's circuit | Too small to tell |
| --- | --- | --- | --- |
| 2 | 17,021 | 15,585 | 1,576 |
| 3 | 13,475 | 12,053 | 5,122 |
| **4** | **11,126** | **9,729** | **7,471** |
| 5 | 10,762 | 9,366 | 7,835 |
| 8 | 10,253 | 8,911 | 8,344 |
| 11 | 6,737 | 5,451 | 11,860 |
| 26 | 4,550 | 3,537 | 14,047 |
| 51 | 2,998 | 2,597 | 15,599 |
| 101 | 959 | 783 | 17,638 |

## Why 4

- **Below 4, a match proves nothing.** 53 designs across 7,520 miners. Calling these copies would call honest circuits copies, which `CLAUDE.md` names as the mistake the product must not make.
- **4 is where the data changes.** Between 3 and 4 gates the miners per design fall from over a hundred to under twenty. Floors from 4 to 10 move only about 900 results; no other break in the data supports a higher number.
- **11 would hide the largest finding.** The 10-gate design used by 3,021 miners would become "too small to tell", along with about 4,400 copy results in all. 3,021 independent arrivals at the same 10 gates is not what the data shows.

## The risk accepted

A task can have a best small design, of 4 to 10 gates, that more than one designer finds independently. Under the earliest-proven-design rule, the later one is still a copy. This is accepted because:

- the result is a fact, never a charge: "Identical to circuit #X, designed 3 days earlier", never "copied from", "fake" or "stolen";
- every result carries its evidence (both circuits, both design times, the netlist hash) and the limit, so anyone can recheck it;
- a designer who wants to prove an earlier design can commit it on chain before tape-out, which the rule already counts.

## Consequences

- The copy check gets the floor as a named constant in `packages/originality`, carried in the rule version. Until that is in, results stay unpublished.
- `CLAUDE.md`: "The size floor below which an identical miner is too small to tell" is struck from "Still open".
- The floor is re-measured if the index grows by a large share, or if a new processor becomes eligible (the sealed mining contract can't add one today). A changed floor is a new ADR and a new rule version, never an edit to this one.
- About half of all miners are copies at this floor, most of them of 8 designs. Results must read as facts at that scale, and the demo and README can state it as Foreman's main finding.
