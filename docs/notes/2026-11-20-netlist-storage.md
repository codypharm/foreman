# Where netlists live and what a REF record is, 20 November 2026

*For William. Answers the top "Still open" item: where TapeOut stores netlists on chain, and the REF record format (TAP-02 §4, §6). Read-only: `eth_call`, `eth_getLogs` and receipts on BNB Chain, nothing signed. Nothing here is in "On-chain facts" yet; adding it is your call. Two findings need a decision before the copy check is built (end of this note).*

## Summary

- **Every circuit's netlist is readable from its processor contract**, at the current block, with one call: `netlist(id)`. Its shape (`nIn`, `nOut`, `nState`, gate count) comes from `circuitInfo(id)`. No archive node is needed to read a netlist.
- **The format is fully written down in TAP-02** and was checked against mainnet by its author and again here today. Three record types: NAND (7 bytes), LATCH (4 bytes), REF (31 + 3 × inputs bytes).
- **A REF record names its target directly:** the processor address and the circuit id. A wrapper's evidence is in its own bytes.
- **Each tape-out emits `TapedOut(uint256 indexed id, address indexed owner, uint32, uint32)`** on the processor, plus the NFT mint and a transistor burn. That event gives the tape-out block, transaction index and log index the copy rule orders by.
- **Real examples found today:** two pure-REF wrappers, a 1,204-gate circuit byte-identical on three processors, and four identical 3-gate circuits on one processor.

## Sources

| Source | What it gives |
| --- | --- |
| [TAP-02: Circuit Netlist Format and Evaluation Semantics](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md), Draft, updated 4 Oct 2026, CC0 | The byte format (§2), well-formedness (§3), read-only functions (§6), deployments |
| `assets/tap-02/chain-verification.md` in the same repo | 24 mainnet circuits decoded and re-encoded byte for byte, 384/384 evaluations matching the chain |
| Circuit implementation `0x8E1D125Def6d3826C278299273a0760D47626068` (`Circuits.sol`, `lib/NetlistVM.sol`, verified on BscScan per TAP-02) | The code behind every processor. Not read directly here |
| Read-only calls today, block 134,663,024 (NodeReal archive endpoint) | Everything under "Checked today" |

## Where netlists are stored

| Piece | Detail | Status |
| --- | --- | --- |
| Processor factory (BNB) | `0x68224f668083c29e9800be2a646d42d18cedf7e2`, UUPS proxy, owner `0xb3d8…3138` (TapeOut's owner), **not sealed** | TAP-02; `cpuCount()` called today |
| Processors | `cpuCount()` = **1,496** today (1,169 on 29 Sep). `cpuAt(i)` lists them in creation order, append-only. `cpuAt(0)` = `0x50a994e7…9dd9` | Called today |
| One processor | An ERC-721 beacon proxy (beacon `0xf8d6…8156`). Circuit ids start at 1; `nextId()` is the next one. `0x50a9…` has 12,938 circuits. **Correction, 20 Nov (later):** `nextId()` returns the *last* id issued, so `0x50a9…` had 12,939; see `packages/originality/fixtures/README.md` | Called today |
| Netlist bytes | `netlist(uint256 id)` (`0x3fc4be56`) returns the records exactly. Stored in 24,000-byte SSTORE2 chunks at tape-out; there is no setter | TAP-02 §6; called today |
| Shape | `circuitInfo(uint256 id)` (`0x084d60f1`) → `(nIn, nOut, nState, gateCount)`. `gateCount` includes gates reached through REF | TAP-02 §6; called today |
| X Layer | A different factory (`0x1f09…0761`) per TAP-10. TAP-02 has not been checked against it, and neither has this note | Unconfirmed |

## The record format (TAP-02 §2)

A netlist is records back to back: no header, no padding, no terminator. Integers are big-endian; signal indices are 3 bytes. `nIn` and `nOut` are **not** in the bytes: they are stored beside them.

| Opcode | Record | Length | Produces |
| --- | --- | --- | --- |
| `0x00` NAND | `a:u24 b:u24` | 7 bytes | 1 signal |
| `0x01` LATCH | `d:u24` | 4 bytes | 1 signal (a one-beat delay) |
| `0x02` **REF** | `cpu:20 bytes, id:u64, nIns:u8, nOuts:u8, ins:u24 × nIns` | **31 + 3 × nIns** bytes | `nOuts` signals: the outputs of circuit (`cpu`, `id`) |

Signals: 0 is constant 0, 1 is constant 1, inputs are 2 to 1 + nIn, then each record's outputs in order. The outputs are the last `nOut` signals.

**What `tapeout` enforces on a REF** (§3): the target processor is registered with the factory; the circuit exists; its `nIn` and `nOut` match `nIns` and `nOuts` (so only circuits with at most 255 inputs and outputs can be referenced); the REF's inputs point backwards. A REF can only name a circuit that already exists, so REF chains have no loops.

**What a REF costs** (§6): `tapeout` burns transistor tokens for the **top-level** NAND and LATCH records only; "REF'd gates are not burned again". A netlist made only of REF records burns nothing, while `circuitInfo` still reports the full gate count of what it points to. This is the zero-cost wrapper in TAPs issue #102.

## Checked today

| Check | Result |
| --- | --- |
| **Pure wrapper** `0x50a9…/6534` | 34 bytes, one REF record: points to `0x50a9…/5388`, 1 input, 1 output. `circuitInfo` says 1 gate |
| **Pure wrapper** `0x1f5c…/38` | 79 bytes, one REF record: points to `0x50a9…/1` with 16 pins, wired to its 8 inputs plus constants 0 and 1. `circuitInfo` says **1,204 gates**, none of them its own |
| **Exact copies** | `0x50a9…/1`, `0x5484…/1` and `0xd3c3…/3`: the same 8,428 bytes (1,204 NANDs), 16 in, 16 out. `0x50a9…` is processor 0, so `0x50a9…/1` is likely the earliest; their tape-out blocks still have to be read |
| **Toy duplicates** | `0x50a9…/42`, `/189`, `/406`, `/1251`: the same 21 bytes (3 NANDs), 2 in, 1 out |
| **A tape-out's events** | Tx `0x9bb50d29…d8f2`, block 134,656,926, circuit `0xb102…/18386` (one NAND of its two inputs): (1) `TransferSingle` on `0xcc42ba5d…8087`, burning 1 unit of token id 0, presumably the transistor token; (2) the ERC-721 mint; (3) `TapedOut(uint256 indexed id, address indexed owner, uint32, uint32)`, topic0 `0xc11215e4…`. The name matches the topic hash. The two `uint32`s were 1 and 0 for a circuit with 1 gate and no state; what they mean is not confirmed |

## Risks to know before building

- **Processors are upgradeable.** The factory is not sealed and processors are beacon proxies. TapeOut could in principle change how stored netlists are read. A result should record the block and the circuit implementation behind the beacon (TAP-02 §7.3). This fits "Published results are reproducible".
- **Evaluation cost is unbounded.** A 31-byte REF can expand to any size. The copy and wrapper checks never need to evaluate a circuit, so Foreman should not evaluate at all.
- **Netlist bytes are untrusted input.** The decoder checks every record length before reading (TAP-02 §7.2).

## Decisions needed before the copy check is built

1. **What "byte-identical" compares.** `nIn` and `nOut` are outside the netlist bytes, and `nOut` decides which signals are outputs. The same bytes with a different `nOut` are a different circuit. *Recommendation:* the netlist hash covers `nIn`, `nOut` and the bytes, and the hash rule is written down with the rule version.
2. **Small circuits are identical by nature.** Four people taping out a 3-gate circuit, or one NAND, will produce the same bytes without copying anyone. Calling the later ones "copies" breaks "anything that could call an honest circuit a copy". The same goes for any circuit two people build with the same deterministic tool from the same design. Options:
   - **a.** Report every byte-identical match, worded strictly as a fact ("Byte-identical to circuit #X, taped out earlier"), and show the gate count beside it.
   - **b.** Only call it a copy above a stated size, for example the smallest mining task's gate count; below that, say "Identical to N earlier circuits; too small to tell".
   - **c.** Only check miners: circuits registered for mining, which have to pass a task's test vectors.

   *Recommendation:* b and c together. The product is about miners, and a stated size floor keeps tiny circuits from being labelled. This is a product decision, so it should be grilled and recorded as an ADR.
3. **Wrappers with real gates too.** A netlist with REF records and its own NANDs is not a pure wrapper. TAP-02 doesn't call it anything. *Recommendation:* show "Uses N REF records to circuit #X" as a fact beside the verdict, never as a verdict.

## Next

- **Record the fixture:** the three byte-identical 1,204-gate circuits, the two wrappers and their targets, a toy duplicate and one ordinary miner, with their `TapedOut` events, as saved RPC responses for the netlist reader's tests.
- **Next "Still open" item:** whether a REF-only wrapper or an exact copy can mine, and with what weight. It decides how many of the circuits above matter to buyers.
