# What can mine: wrappers, copies and weight, 20 November 2026

*For William. Answers the "Still open" item "Can a REF-only wrapper or an exact copy mine, and with what weight?". Read-only: the verified mining source on Sourcify and `eth_call` / `eth_getLogs` on BNB Chain (NodeReal archive endpoint), nothing signed. It changes two decisions in `docs/decisions/2026-11-20-copy-and-wrapper-rules.md`; see the end.*

## Summary

- **A wrapper can't mine.** The mining contract refuses any netlist with even one REF record (`Nref`). That covers pure wrappers and netlists that mix REF records with gates.
- **An exact copy can mine, without the design bonus.** It stays in the verified pool with weight = its own burned gates × the processor's multiplier. The design bonus goes to one miner per task per processor: the lowest design cost, then commitments, then the earlier tape-out.
- **Only two processors can mine:** `0x1f5c…f12c` (multiplier 6) and `0xb102…a14c` (multiplier 1). The contract is sealed, so that list is final.
- **None of the wrappers or copies found earlier is a miner.** They all sit on processors that can't mine.
- **So the mining contract already does part of Foreman's job** inside one processor. Foreman's copy check adds two things it can't see: copies **across** the two mining processors, and a miner copied from a circuit taped out on a processor that can't mine.

## Sources

| Source | What it gives |
| --- | --- |
| `src/PodMining.sol`, logic contract `0xa3dbe873…f898`, Sourcify full match (`https://sourcify.dev/server/v2/contract/56/0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898`) | The rules below. Comments are in Chinese; the quotes here are translations |
| `getMiner`, `processorMultiplier` and `ProcessorSet` events on the mining proxy `0x7e2e…7b46`, read 20 Nov | Which circuits mine, which processors count |

## What the source says

| Rule | Where | Detail |
| --- | --- | --- |
| **No REF at all** | `_requireRefsEligible`, called by `start` | Reads the netlist's REF targets and reverts `Nref` if there are any. The comment says: "this version bans REF completely: any reference in the netlist = no mining eligibility at all". Reason given: a one-REF shell (about 33 bytes, nothing burned) inherited the referenced circuit's area and depth and took the full design bonus. "14 zero-burn shells pushed the real designer's share from 100% to 28%" in a local test |
| **Processor must be eligible** | `start`: `processorMultiplier[circuits]` must be > 0, else `Cpu` | Eligibility is a governance list set with `setProcessor` before sealing |
| **Weight** | `hashrateOf(b*, bonus, P)` | H = (b* + design bonus) × P. b* = own NANDs + 6 × own LATCHes, counting only gates burned at tape-out (never through REF) |
| **Design bonus: one per task per processor** | `bestSlot[taskId][processor]`, `_winsSlot`, `_demoteSlotHolder`, `reclaim` | The holder is the miner with the **strictly lowest design cost** C = A × max(d,1)³. On equal cost (a true copy): a valid design commitment wins, then the earlier commitment, then the earlier tape-out (lower circuit id). A beaten holder is demoted (`Demoted`) and keeps its weight without the bonus |
| **Copies still earn** | Comment above `_demoteSlotHolder` and in the header | A copy that passes the task "stays in the verified pool": no design bonus, H = b* × P. The authors chose this on purpose ("any penalty must first recognise the cost") |
| **Front-running defence** | `commitDesign`, `firstUnusedId` | A designer commits a hash of their netlist before taping out. A front-runner who copies the netlist from the mempool can't win the slot against a valid earlier commitment |
| **Sealed** | `isSealed = true` (`docs/notes/2026-11-18-mining-contract-findings.md`) | None of this can change |

## Checked on chain

| Check | Result |
| --- | --- |
| Processors ever set (`ProcessorSet` from the contract's creation at block 117,234,441) | 3: `0x1f5cb4ae…f12c` multiplier **6**; `0xb1024b89…a14c` multiplier **1**; `0xf4412c52…e28e` multiplier 0 |
| `processorMultiplier` today | `0x1f5c…` 6, `0xb102…` 1; `0x50a9…`, `0x5484…`, `0xd3c3…` 0 |
| Miners today | `minerCount` = 20,861 |
| Earlier wrappers and copies | `0x50a9…/6534`, `0x1f5c…/38`, `0x50a9…/5388`, `0x50a9…/1`, `0x5484…/1`, `0xd3c3…/3`, `0x50a9…/42`: all status "none", weight 0. Not miners |
| Log range | NodeReal returns the same 13,734 `Claimed` events for one 50,000-block request as for ten 5,000-block requests; ranges above 50,000 blocks are refused with an error, not emptied |

## What this changes for Foreman

1. **The Wrapper verdict never applies to a miner.** Decision 2 of `2026-11-20-copy-and-wrapper-rules.md` gives verdicts to miners only, so decisions 5, 6 and 7 (REF facts, wrapper chains, wrapper before copy) would never be used. Wrappers matter for **listings that aren't miners**: issue #102's complaint is markets listing them as compliant, and 101 of the 218 items listed in the 7-day market read were not miners.
2. **For a miner, "can it mine?" is already settled by the chain.** It's on an eligible processor, has no REF and passed a task. A listing can be checked the same way before anyone buys it.
3. **Within one processor, the contract already ranks identical designs.** `optimal` and `bonus` in `getMiner` say who holds the design bonus. Foreman's copy check adds what the contract can't see:
   - copies **across** the two mining processors (each has its own bonus slot, so a copy on the other processor can hold the bonus there);
   - a miner whose netlist was first taped out on a processor that **can't** mine, so its first designer could never hold the bonus.
4. **A copy's value is already in its weight.** A copy that lost the bonus has a lower weight, and the valuation reads that weight. This matches "no invented copy discount".

## Two more findings in the source

Both came up while grilling the decisions below, and both are explained in the source's own comments.

| Finding | Where | Detail |
| --- | --- | --- |
| **"Earliest tape-out" can be front-run** | Header comment on `commitDesign`; `DesignCommit`; `_winsSlot`; `PodNetlist.challengerWinsSlot` | `tapeout(netlist, …)` goes into the mempool in plain text. A bot can copy the netlist, tape it out first with more gas and get the lower circuit id, "and the real author is judged the copy". The defence is `commitDesign(circuits, keccak256(abi.encode(designer, circuits, keccak256(netlist), salt)))` at least one block before the tape-out. Each commitment freezes `firstUnusedId` (the processor's next circuit id at commitment time), so it only beats circuits that didn't exist yet. When both sides have valid commitments, the earlier commitment wins, then the lower circuit id. `start` checks the salt and stores the block in the miner's `commitBlock`, which carries over when a miner restarts. `DesignCommitted(bytes32 indexed commitment, address indexed designer, address indexed circuits, uint256 blockNumber, uint64 firstUnusedId)` records each commitment |
| **One swap changes the hash** | Comment above the counterexample set (`反例必检集`) | A NAND's two inputs are symmetric, so swapping them gives "function, gate count, depth, area, C and bonus all unchanged; only the keccak changes". The authors found 262 of 267 bonus-holding netlists on chain could be changed this way at no cost. A byte-identical check misses that copy |

## Decided

William decided all of the below, and the two findings above, in a grilling on 20 November: `docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md`.

## Decisions this needs

These reopen parts of today's ADR, so the answer is a new ADR that supersedes them, not an edit:

- **Which circuits get a verdict?** Miners only (decision 2) leaves wrappers out entirely. *Recommendation:* give a verdict to **miners and to anything listed on the market**, and add one fact every listing gets: **"Can mine: yes / no, and why"** (processor not eligible, uses REF, not started).
- **What does "Copy" add for miners?** *Recommendation:* show the contract's own answer first (holds the design bonus or not) and Foreman's byte check beside it, so cross-processor copies and copies of non-mining circuits are visible.
