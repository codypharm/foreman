# A copy check for FabX miners on X Layer

- **Date:** 25 November 2026
- **Status:** Accepted, with a go/no-go on 1 December 2026
- **Decided by:** William, in a grilling of ten questions, each with a recommended answer and its alternative
- **Research:** `docs/notes/2026-11-25-fabx-on-x-layer.md`
- **Extends:** `2026-11-20-circuit-index.md` (BNB Chain only for the MVP), `2026-11-20-size-floor.md` (re-measured when a new processor becomes eligible), `2026-11-21-results-contract.md` (BNB Chain circuits only). None of them is edited; this record adds X Layer beside them

## Context

TapeOut's own mining (BEM) runs only on BNB Chain. X Layer has a second Proof of Design mining system, **FabX**, which mines its own token, FAB, with circuits from TapeOut's X Layer processor factory. On 25 November 2026 it had 7,125 mining miners. A probe with Foreman's own hash found 4,939 of them identical to an earlier circuit at 4 gates or more. Nothing on X Layer shows this today.

FabX's mining contract is not TapeOut's. It is upgradeable, its source isn't verified, and one plain wallet owns it. Its circuits, though, are held by a processor that runs TapeOut's shared processor code, which FabX's owner can't change.

William was offered three scopes: A, name FabX as not covered; B, a copy check for FabX miners and no value; C, B plus value, payback and FabX's market. **He chose B, guarded:** the verdict rests only on what FabX's owner can't edit, and it is cut if it isn't right by 1 December.

## Decisions

### 1. A FabX miner is a miner, and every result names its mining contract

"Miner" widens to: a circuit registered for Proof of Design mining in a mining contract Foreman follows. Today those are TapeOut's (BEM, BNB Chain) and FabX's (FAB, X Layer).

Every `Originality` names its mining contract by chain and address. The name shown ("TapeOut", "FabX") comes from CLAUDE.md's On-chain facts, never from anything a contract says about itself.

*Rejected:* inferring FabX from chain 196, which X Layer's 450 processors and any later mining system there would make wrong. *Rejected:* a separate term such as "FabX circuit", which would read as a downgrade of what are registered, mining miners, and would need a second set of wording everywhere.

### 2. On screen: "FabX · X Layer", with one line of facts

Results are labelled "FabX · X Layer" or "TapeOut · BNB Chain". Every FabX result carries:

> "FabX is a mining system on X Layer that mines FAB with circuits from TapeOut's X Layer factory. It's separate from TapeOut's BEM mining, and its contracts are controlled by their own owner."

Never on screen: "official", "unofficial", "TapeOut on X Layer", or who is behind FabX. The chain shows which wallet controls it, not who. The layout of the label and the line is mocked first and chosen by William.

*Rejected:* "TapeOut on X Layer (FabX)", which implies an endorsement nobody has confirmed.

### 3. The size floor for FabX is 4 gates, measured on FabX's own circuits

Measured on FabX's 7,164 circuits at X Layer block 76,839,338 (the table is in the note). As on BNB Chain, 1 to 3 gates have 8 to 60 miners per design, and from 4 gates it falls to about 10. The floor stays **4**.

The largest group, one 20-gate design shared by 1,533 circuits, stays **Copy**. All of them are on task 48, which also has 13- and 14-gate designs, so 20 gates isn't an answer honest designers converge on. 1,121 of the 1,533 were registered by one address. The "taped out by the same address" fact states that without changing the verdict.

At this floor: 4,939 copies (4,624 of a circuit registered by a different address) and 863 too small to tell.

*Rejected:* a floor of 21, which would hide the clearest finding against the data. *Rejected:* a separate rule for designs dominated by one address; the fact line covers it.

### 4. One order across both chains

A circuit on one chain is a copy of an identical circuit on the other when its design time is later.

- **Across chains,** design times are compared in Unix seconds, each its block's own timestamp (tape-out, or an accepted design commitment).
- **Within one chain,** the existing order still decides: block, then transaction index, then log index.
- **The same second on two chains** can't be ordered, and neither is called a copy of the other.

It applies both ways. FabX results are checked against BNB Chain's index and FabX's circuits. BNB Chain results are also checked against FabX's. Measured on 25 November, it changes 58 FabX results (first of their design on FabX, but on BNB Chain before FabX existed) and at most one BNB Chain design.

The evidence names each circuit's chain ("Identical to circuit #X on BNB Chain, taped out 2 months earlier"). Coverage counts both chains.

*Rejected:* checking FabX only against FabX. That would say "no earlier copy found" while Foreman holds an earlier identical circuit.

### 5. A FabX design commitment counts only when its event is found

A miner's `commitBlock` is read from FabX's contract, then that one block's logs are read for FabX's `DesignCommitted` event with the same designer and processor.

| Event | Effect |
| --- | --- |
| **Found** | The commitment is the design time, as on BNB Chain. The evidence names the event's transaction |
| **Not found, and it would change which circuit is earlier** | The result is **Can't check**: "FabX's record of this design commitment doesn't match its event history". Never copy, never no earlier copy found |
| **Not found, and it wouldn't change the order** | The tape-out decides |

A confirmed commitment is stored in the index and never re-read, so a later upgrade can't move it.

*Rejected:* trusting `commitBlock` from storage as on BNB Chain. That's safe there only because that contract is sealed.

### 6. A change to FabX's contract freezes FabX results

| FabX event | Effect |
| --- | --- |
| `Upgraded`, `OwnershipTransferred`, `ProcessorSet` | **Freeze:** the worker stops updating and publishing FabX results; BNB Chain results carry on |
| `Paused`, `Unpaused` | Followed: they change only can-mine, which is read live |
| `BoostSet` | Followed: it changes only weights, and no FabX value is shown |

While frozen:

- every FabX page shows its last result with "FabX changed its mining contract at X Layer block B. Foreman hasn't reviewed the change; this result was read at block A, before it";
- results already published stay valid as facts at their block;
- `GET /health` reports FabX as frozen without turning the whole service to 503.

Only William unfreezes it. First the new code is compared with the reviewed version (miner record layout and events), or the new processor is indexed. Then the change is recorded in On-chain facts with its date.

Every FabX result carries: "FabX's owner can change its mining contract. Read at X Layer block B; Foreman stops FabX results if it does."

*Rejected:* carrying on with a notice, which would keep publishing results about code nobody has reviewed.

### 7. FabX results go to the deployed ForemanResults, with every field's meaning unchanged

ForemanResults on the X Layer testnet (`0xe1b2…13e8`) is not upgradeable and stays as it is:

- **`indexBlock`** stays the BNB Chain block the index was read up to, for FabX results too: they were checked against BNB Chain up to that block. The X Layer block goes in the full result, tied to `resultHash`.
- **`canMine`** for a FabX miner comes from FabX's contract, with the same four codes.
- **Keys** stay `keccak256(processor, circuitId)`. The two factories have different addresses, so their processors can't share an address. The publish job still refuses any key already used by a circuit on the other chain.

Results are told apart by processor (FabX's is `0x87bf…f9a6`), by the full result's chain and mining contract, and by rule version.

**The gap accepted:** storage alone doesn't state the chain. A reader of `resultOf` already knows which processor it asked about, and the README lists it.

*Rejected:* a new contract version that stores the chain and both blocks. That means a redeploy, a new address, and results split across two contracts, ten days before the freeze.

### 8. Where FabX appears

| Place | FabX |
| --- | --- |
| **Check box** | Yes. A miner key and "processor + id" work as they are. "FabX 1234" and "FabX #1234" are added. A bare number stays a TapeOut market listing number |
| **Result page** | Yes, mocked first: the label, the two lines, the verdict with its cross-chain evidence, and "Value: not covered yet" in place of the worth section |
| **Your miners** | Only after the core works end to end and before 30 November. It is the first thing dropped |
| **Live listings** | No. FabX's market isn't read or confirmed |
| **README** | Yes, once it works: coverage, addresses, limits, one headline number with its coverage and block |

### 9. Addresses, and no FabX publish before the processor history is read

Five entries go into CLAUDE.md's On-chain facts, dated 25 November 2026, each with its evidence in the note:

- the X Layer processor factory;
- the shared processor beacon;
- FabX's processor;
- FabX's mining contract (third party, unsealed, unverified);
- Multicall3 on X Layer.

FAB, FabX's rig market and the other 449 processors are not used.

**FabX's eligible processors** are recorded as "one known; history confirmed before the first FabX publish". No FabX result is published until FabX's `ProcessorSet` history has been read in full.

### 10. Which facts a FabX result shows

| Fact | On FabX results |
| --- | --- |
| Can mine | Yes, as the status FabX's contract reports, in the four states |
| Can't-mine reasons | "Uses REF records" and "processor not eligible" only. Not "failed a test vector": FabX's tasks aren't read |
| Design bonus | No. Its meaning in unverified code is an assumption, and it's a value-side fact |
| Taped out by the same address | Yes, from the processor's events |
| N miners share this design | Yes, from the index |

*Rejected:* every fact FabX's contract reports, labelled as reported. That would put Foreman's name beside meanings nobody has verified.

## Go/no-go: 1 December 2026

**Go** means a FabX miner, typed into the Check box on the live site, shows a correct verdict with its evidence. Its result is published to the testnet and read back. A test shows the freeze stops FabX publishing.

**No-go** cuts FabX first, ahead of everything on the existing cut list. The README names FabX under "Limits today". The FabX entries stay in On-chain facts, as facts.

## Consequences

- **Data contract:**
  - `Originality` gains the mining contract;
  - `index` gives coverage per chain;
  - the cross-chain order rule is added;
  - "Published result" no longer says BNB Chain circuits only.
  
  FabX results carry their own rule version, and BNB Chain results a new one for the cross-chain check.
- **`packages/originality`:** the X Layer tape-out scan and netlist reads for FabX's processor; commitments confirmed by event; cross-chain order; the freeze.
- **X Layer reads:** public nodes serve logs 100 blocks per read and about 5 reads at a time. FabX's history since block 73,042,958 (about 38,000 reads) is read once and followed every 5 minutes after.
- **Tests that are not optional gain:** the cross-chain order and the same-second case; a commitment without its event; the freeze on a fake `Upgraded` event.
