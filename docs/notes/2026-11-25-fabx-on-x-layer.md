# FabX: Proof of Design mining on X Layer

*Research behind `docs/decisions/2026-11-25-fabx-copy-check.md`. Everything below was read on chain on 25 November 2026 unless it says otherwise. Probe scripts and data were kept in the session's scratchpad, not in the repo; the method is described here so it can be repeated.*

## What's on X Layer

- **TapeOut's own mining isn't.** BEM is mined only by the sealed PoD contract on BNB Chain. On X Layer, BEM is a LayerZero token and RIG vouchers stand for BNB Chain miners (`2026-11-19-xlayer-market-findings.md`). TapeSurge's repo says the same: "There is no PoD … on X Layer" (its survey of 20 October).
- **TapeOut's processor factory is.** It holds 450 processors, and circuits are taped out on them.
- **FabX is a second Proof of Design mining system** on X Layer. It mines FAB with circuits from one processor in that factory. On 25 November it had 7,125 mining miners.

## The X Layer processor factory

| | |
| --- | --- |
| Address | `0x1f09daefa827f02cbb40967cc91b259763760761` (ERC-1967 proxy) |
| Implementation | `0x336e9f0f4c3fee7c8c803377e4dea00293f4ae2a`, 9,376 bytes |
| Against the BNB factory's implementation (`0x51535d8e…3fc4`) | Same length. Identical except two 20-byte runs that hold each contract's own address (its UUPS self-reference). Same CBOR metadata, so the same source and compiler |
| `owner()` | `0xb3d85b42a045c1a88d800cad0f55d2566a4d3138`, TapeOut's owner on BNB Chain |
| `cpuCount()` | 450 at X Layer block 76,838,286 |
| Also | TapeOut's TAP-02 and TAP-10 list it as the X Layer processor factory (`2026-11-19-xlayer-market-findings.md`) |

## Processors share one code, which nobody can change

Every factory processor checked is a beacon proxy of beacon `0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c`: processor #0 (`0x839b…574e`) and FabX's (#323).

- **`owner()` on the beacon reads the zero address.**
- **The beacon's implementation** (`0x977f217887e085d298cb3819cdad5a0ee35f29b2`, 12,562 bytes) has the same 26 functions as TapeOut's BNB processor implementation (`0x8e1d125d…6068`, 12,560 bytes). The two builds differ: 2 bytes longer, different metadata.
- **Every one of FabX's 7,164 netlists decoded** with Foreman's reader (`decodeNetlist`), with no failures. The record format is the same.

## FabX's contracts

| | Address | Created |
| --- | --- | --- |
| Processor, "FAB-Genisis CPU" | `0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6`. #323 in the factory, and `factory()` returns it | Block 73,042,958, 12 Oct 2026 13:33:14 UTC, tx `0x77b7bc9a…ccad9` |
| FAB token | `0x72f349b1eee7833b26f8c81a8410775a4e231ed2`, 8 decimals | Block 73,100,840, 13 Oct 05:37:56 UTC |
| Mining contract | `0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265` (ERC-1967 proxy). Implementation `0x90681776c2d6be4676d83fa8fef22836b5dbbeeb`, 24,505 bytes, not on Sourcify | Block 73,100,842, 13 Oct 05:37:58 UTC, tx `0x42fa0756…5fc5a` |

**All three were deployed by `0xfb7708019e64462126bafffc30c03e770e455ef8`,** a plain wallet: no code, nonce 423, 6.9 OKB. That wallet is also `owner()` of the mining contract. It is not TapeOut's owner.

**The mining contract's state:**

| Read | Value |
| --- | --- |
| `isSealed()` | false |
| `paused()` | false |
| `minerCount()` | 7,125 |
| `totalVerifWeight()` | 386,754,480 |
| `currentRate()` | 8,333,333 (BEM's era-0 figure: 7,200 a day at 8 decimals) |
| `startTime()` | 13 Oct 2026 12:02:00 UTC |
| `token()` | FAB |
| `processorMultiplier(FabX's processor)` | 6 |
| `processorMultiplier`, every other factory processor | 0 |

**Its code against TapeOut's verified PodMining logic** (`0xa3dbe873…f898`), by function selectors read from the bytecode:

- **90 functions are shared.**
- **FabX adds:** `boost()`, `boostOf(address)`, `setBoost(address)` and one unnamed function.
- **FabX lacks:** `miners(bytes32)`, `hashrateOf(uint64,uint64,uint256)` and `lambdaBurn()`.

**Event signatures present in both:** `DesignCommitted(bytes32,address,address,uint256,uint64)`, `ProcessorSet(address,uint256)`, `Upgraded(address)`, `OwnershipTransferred(address,address)`, `Paused(address)` and `Unpaused(address)`. FabX alone has `BoostSet(address)`.

`getMiner(keccak256(processor, id))` decodes with TapeOut's layout (`podMiningAbi` in `packages/chain-bnb`). Over all 7,164 circuits the statuses read: 7,125 active, 16 cooling, 23 none. 5,609 have a `commitBlock`. That is consistent, but not proof, since the source isn't verified.

**Not checked:**

- FabX's `ProcessorSet`, `Upgraded` and `OwnershipTransferred` history (a log scan of about 38,000 reads, the build's first step);
- FabX's tasks and test vectors;
- what `boost` does.

**FAB's supply doesn't match its emission.** `totalSupply()` was 1,275,533.8 FAB. At 7,200 a day since 13 October, mining could have produced at most about 310,000, unless the boost raises output. The rest wasn't traced. This matters for any later FabX value, not for a copy check.

## Multicall3 on X Layer

`0xca11bde05977b3631167028862be2a173976ca11`: runtime code hash `0xd5c15df6…`, byte-identical to the BNB Chain Multicall3 already in On-chain facts. All the probe's reads used it.

## X Layer public nodes

| Node | Logs per read | Old state |
| --- | --- | --- |
| `rpc.xlayer.tech`, `xlayerrpc.okx.com`, `xlayer.drpc.org` | 100 blocks; 1,000 refused | Served 3 million blocks back |
| Ankr, Omnia, Blast | Didn't answer | — |

In a JSON-RPC batch of 10 log reads, the first 5 succeed and the rest get `-32016 over rate limit`. Blocks are 1 second apart.

## The probe: how many FabX miners are copies

**Method:**

1. At X Layer block 76,839,338, read every circuit on FabX's processor (ids 0 to 7,164): `netlist(id)`, `circuitInfo(id)`, and `getMiner(minerKey)`, through Multicall3.
2. Hash each netlist with `hashNetlist` from `packages/originality`, unchanged.
3. Count a circuit as earlier by its lower id, since one processor's ids follow tape-out order. **Design commitments were ignored.** They can change which circuit in a group is earliest, but not, by more than one per design, how many circuits follow it.

**Results:**

| | Count |
| --- | --- |
| Circuits read | 7,164 (id 0 failed to read) |
| Mining miners | 7,125 |
| Identical to an earlier FabX circuit, 4 gates or more | **4,939** (69%), in 241 designs; 4,624 of a circuit registered by a different address |
| Identical, under 4 gates | 863 |
| First of their design | 1,323 |
| Pure-REF wrappers | 2 |
| Designs overall | 1,329 |

**Copies by size:**

| Gates | Copies |
| --- | --- |
| 4–9 | 431 |
| 10–49 | 1,944 |
| 50–199 | 1,922 |
| 200 or more | 642 |

### Size-floor table (mining miners)

| Gates | Miners | Match an earlier circuit | Designs | Miners per design |
| --- | --- | --- | --- | --- |
| 1 | 201 | 196 | 5 | 40.2 |
| 2 | 23 | 20 | 3 | 7.7 |
| 3 | 658 | 647 | 11 | 59.8 |
| 4 | 120 | 110 | 11 | 10.9 |
| 5 | 111 | 96 | 15 | 7.4 |
| 6 | 134 | 124 | 10 | 13.4 |
| 7 | 30 | 23 | 7 | 4.3 |
| 8 | 52 | 45 | 7 | 7.4 |
| 9 | 49 | 33 | 16 | 3.1 |
| 10 | 48 | 25 | 24 | 2.0 |
| 20 | 1,548 | 1,534 | 14 | 110.6 |
| 66 | 461 | 448 | 13 | 35.5 |
| 463 | 212 | 211 | 1 | 212.0 |

| Floor | Copy | Copy of a different registrant | Too small to tell |
| --- | --- | --- | --- |
| 2 | 5,606 | 5,270 | 196 |
| 3 | 5,586 | 5,250 | 216 |
| **4** | **4,939** | **4,624** | **863** |
| 5 | 4,829 | 4,514 | 973 |
| 8 | 4,586 | 4,282 | 1,216 |
| 11 | 4,483 | 4,186 | 1,319 |
| 21 | 2,787 | 2,504 | 3,015 |
| 51 | 2,332 | 2,068 | 3,470 |

### The 20-gate group

One 20-gate design (netlist hash `0xfb118fc4…`) is shared by **1,533 circuits, all on task 48**.

- **Smaller designs exist for the same task.** Task 48's designs, as miners and gates: 1,533 × 20, 6 × 14, 5 × 13, 2 × 14, 2 × 20, 1 × 70, 1 × 13, 1 × 14.
- **Registrants:** 29 addresses registered the group; one registered 1,121 of the circuits.
- **Earliest:** circuit id 1,648.

### Against BNB Chain's index

Compared with the local index (80,455 BNB Chain circuits) by netlist hash:

- **1,475 FabX miners share a design with a BNB Chain circuit, 622 of them at 4 gates or more** (60 designs). For 621 of the 622, BNB Chain had the design before FabX's processor existed (12 Oct 13:33:14 UTC).
- **Of the 1,304 FabX miners that are the first of their design on FabX** (4 gates or more), **58 have that design on BNB Chain earlier.**
- **In the other direction,** one BNB Chain design whose first circuit was taped out after FabX launched also appears on FabX.

## FabX Miner Desk, another hackathon entry

[runesleo/fabx-miner-desk](https://github.com/runesleo/fabx-miner-desk), created 19 October 2026: a read-only dashboard for FabX miners.

- **What it does:** build-versus-buy cost, measured output, payback scenarios, wallet lookups, Telegram alerts (rig stopped, revoked or demoted; output drop; cheap listings; FabX governance events), and a TapeOut ecosystem radar.
- **What it doesn't do:** no copy, wrapper or netlist check. It deploys no contracts. It explicitly covers FabX only.

No public evidence links it to FabX's owner:

- **The owner's wallet** appears nowhere in its code or in public GitHub code.
- **Its link list** cites FabX's front-end bundle (`indexed-mCl0T3Dn.js`, `VITE_XMAKE_ADDRESS`) as the source of addresses.
- **Its code** notes that FabX's official API blocks browser requests from other sites.

## Sources

- On-chain reads: X Layer (chain 196) through `rpc.xlayer.tech`; BNB Chain through `bsc-rpc.publicnode.com`; the local index database.
- [FabX Miner Desk README](https://github.com/runesleo/fabx-miner-desk) and its `docs/links-verification.md`, the source of FabX's addresses, all re-read on chain.
- [TapeSurge on X Layer](https://github.com/lincwang123-bot/tapesurge-xlayer), for "no PoD on X Layer".
- [93.bitmap on X](https://x.com/93bitmap/status/2107798918889398573), on miners crossing to X Layer as vouchers.
