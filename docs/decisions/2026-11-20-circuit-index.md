# The circuit index: scope, tape-out order, storage and freshness

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling (one question at a time, each with a recommended answer; every recommendation was taken)
- **Settles:** "How to index every circuit since launch" in `CLAUDE.md`, "Still open"
- **Builds on:** `2026-11-18-api-and-jobs.md` (Postgres, pg-boss), `2026-11-20-copy-and-wrapper-rules.md` (decision 3, the size floor), `2026-11-20-verdict-scope-and-earliest-design.md` (decision 4, the earliest proven design)

## Context

The copy check compares a circuit with every circuit in the index, so what the index leaves out can never be named as the earlier circuit. The miners `0x1f5c…/1008`, `/1144` and `/1147` were found to copy `0xf441…/63` only because that processor, which can't mine, was read.

Measured on 20 November 2026 (NodeReal archive endpoint, block 134,673,279):

| Measurement | Result |
| --- | --- |
| Processors listed by the factory (`cpuCount`) | 1,496; 312 empty, 61 with 100 or more circuits |
| Circuits (sum of each processor's `nextId()`) | 80,290. Largest: `0xb102…` 18,386, `0x50a9…` 12,939, `0xcc6b…` 9,574 |
| First tape-out | `0x50a9…/1`, block 116,070,652 |
| `TapedOut` logs with no address filter, one 50,000-block read | 91 logs from 6 processors in 2.9 s (from block 116,100,000); 10 logs from 2 processors in 0.8 s (from block 134,600,000). Every address was a listed processor |
| Whole history | About 372 such reads, 10 to 20 minutes |
| Netlists | One `netlist` and one `circuitInfo` call per circuit: about 160,000 calls, about 5 hours at today's rate |

`nextId()` returns the last id issued (`packages/originality/fixtures/README.md`).

## Decisions

### 1. Scope: every BNB Chain processor

*Options:* every processor; mining processors plus listed ones; processors above a size.

The index holds every circuit on every processor the factory lists: 80,290 circuits today. "No earlier copy found among N circuits" then means what it says.

### 2. Tape-out order: one scan, filtered, with a count check

*Options:* one scan with filter and count check; per-processor scans; a binary search per circuit.

- Read `TapedOut(uint256 indexed id, address indexed owner, uint32, uint32)` across every block from the first tape-out, with no address filter, in reads of 50,000 blocks or fewer.
- Keep only events from processors the factory lists. A look-alike contract emitting the same event is dropped, and the drop is logged.
- **Count check:** each processor's number of `TapedOut` events must equal its `nextId()` at the index block. A mismatch stops the index; a gap is never left silently. This is the "check before trusting an empty read" rule in `CLAUDE.md`, applied to the whole index.

Each event gives the circuit's tape-out position (block, transaction index, log index) and its tape-out address.

### 3. BNB Chain only, stated

*Options:* BNB only; both chains now; X Layer as a stretch.

X Layer circuits are not indexed for the MVP: the X Layer factory is unconfirmed, and TAP-02 hasn't been checked against it. Every result states its coverage as "among N BNB Chain circuits". RIG vouchers are still covered, because each one stands for a miner whose circuit is on BNB Chain.

### 4. Stored per circuit: bytes, hashes and tape-out

*Options:* bytes, hashes and tape-out; hashes and tape-out only.

Per circuit, the index keeps:

- the netlist bytes;
- `nIn`, `nOut`, `nState` and `gateCount`;
- the netlist hash and byte hash, with the rule version;
- the tape-out position and address;
- the block each was read at.

Netlists can't change once taped out (no setter), so a new hash rule re-hashes the stored bytes instead of reading the chain again.

Per miner, it also keeps the design commitment block from `getMiner` (about 21,000 miners on the two processors that can mine). The earliest-proven-design rule needs it, and so do the miner status and the "Can mine" fact.

### 5. Staying current: follow every 5 minutes, catch up on demand

*Options:* follow and catch up on demand; follow only; rebuild daily.

- A job reads new `TapedOut` events and new miner starts every 5 minutes from the last block it read. Miner starts matter because a commitment is stored when a miner starts, which can be long after its tape-out.
- When someone checks a circuit taped out after the index's last block, Foreman first catches the index up to the head, then checks.
- "Can't check: outside the index" remains for a circuit that still isn't there after catching up.
- Every result carries the block the index was read up to.

### 6. The size floor: William picks it from the measurement

*Options:* William picks from the chart; a stated formula; the smallest task's size.

Once the index exists, Foreman produces a chart and a table: at each gate count, how many identical groups there are and how many cross tape-out addresses. William picks the floor, and it is recorded in an ADR with the chart. Small circuits match by nature (the one-NAND miner `0x1f5c…/46` is identical to a later circuit), while real cross-address copies exist at 603 and 1,204 gates, so the data alone can't draw the line.

### 7. Built locally, moved when hosting is chosen

*Options:* local Postgres then move; decide hosting first; files for now.

The index is built in a local Postgres (Docker) with William's archive endpoint, and dumped into the host once hosting is decided. The NodeReal plan's monthly allowance is checked before the full run.

## Consequences

- `CLAUDE.md`: the item is struck from "Still open". The tech stack row "Circuit index and originality check" is filled in. A new RPC note: a `TapedOut` read with no address filter returns every processor's tape-outs.
- `docs/PRODUCT.md`: "How it works", step 1, describes this. The same item is struck.
- `docs/data-contract.md`: coverage reads "among N BNB Chain circuits, up to block B".
- **New tool:** Docker, to run Postgres locally. It replaces nothing (Postgres was already decided in `2026-11-18-api-and-jobs.md`). A compose file comes with the index code.
- **Tests** (`CLAUDE.md`, "Coverage" and "Bad input"):
  - a processor whose event count doesn't match `nextId()` stops the index;
  - a look-alike event is dropped;
  - a circuit newer than the index is caught up, then checked;
  - a circuit still missing after catching up is "Can't check".
- **Size floor:** measured after the first full run; until William records it, no `copy` verdict ships (`2026-11-20-copy-and-wrapper-rules.md`, decision 3).
