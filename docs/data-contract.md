# Foreman data contract

*The shapes every part of Foreman shares. Owned by William since 20 November 2026 (`docs/decisions/2026-11-20-scope-and-team.md`); first decided by Furqaan in `docs/decisions/2026-11-19-data-contract.md`. Types and parsers live in `packages/contract`. Code against this; a field you need that is not here is a proposal to William, not a local addition.*

**Status of each shape:** **Settled** means build against it. **Provisional** means the shape holds but fields may change when a named fact is confirmed.

| Shape | Status | Written by | Read by |
| --- | --- | --- | --- |
| `Sourced<T>` | Settled | Everyone | Everyone |
| `Miner` | Settled | BNB reader | Valuation, originality, API, app |
| `NetworkState` | Settled | BNB reader | Valuation, API, app |
| `Valuation` | Settled | Valuation engine | API, app |
| `Price` | Settled; a currency pair is still open (BNB and OKB against BEM) | API job | App |
| `Offer` | Settled (`2026-11-19-offer-shape.md`) | Readers (BNB market, TapePool) + comparables rule | API, app |
| `CircuitRef` | Provisional: storage known (`docs/notes/2026-11-20-netlist-storage.md`); waits for the netlist reader | Circuit index | Originality, API, app |
| `Originality` | Provisional: rules decided (`2026-11-20-copy-and-wrapper-rules.md`, `2026-11-20-verdict-scope-and-earliest-design.md`); waits for the netlist reader and the size floor | Originality check | API, app, publish job |
| `PublishedResult` | Provisional: waits for the results contract design | Publish job | App, markets, lenders |
| ~~`Policy`, `TapeOutResult`, `AgentKey`, `ActionLogEntry`~~ | **Withdrawn** 20 Nov 2026 with autopilot (`2026-11-20-scope-and-team.md`). Parsers removed in a later commit | — | — |

---

## Wire format

| Kind | In TypeScript | On the wire (JSON) |
| --- | --- | --- |
| Token amounts | `bigint`, base units (BEM: 8 decimals) | Decimal string: `"5169000000"` is 51.69 BEM |
| Weights | `bigint`, plain integer | Decimal string |
| Times | `bigint`, Unix seconds | Decimal string |
| Blocks | `bigint` | Decimal string |
| Rates in parts per million | `bigint` (10,000 = 1%) | Decimal string |
| Addresses, miner keys, hashes | `Address` (20 bytes), `Hex32` (32 bytes) | Lowercase `0x` hex, length checked |
| Chain ids | `56` (BNB Smart Chain) or `196` (X Layer) | Number |

Use `packages/contract`'s parse and serialise functions on both sides. Never convert by hand. **A value that does not parse is an error, never a zero or a default.**

---

## Shapes

### `Sourced<T>`: where a number came from

```ts
type Sourced<T> =
  | { value: T; source: "chain"; chainId: 56 | 196; block: bigint }
  | { value: T; source: "constant"; ref: string }      // "PodMining.INITIAL_RATE"
  | { value: T; source: "assumption"; basis: string }; // "fastest 7-day growth since 21 Aug"
```

### `Miner`

```ts
interface Miner {
  key: Hex32;                     // miner key
  processor: Address;             // the NFT contract (`circuits`)
  tokenId: bigint;                // `circuitId`
  owner: Address;                 // current NFT holder; claims mint here
  status: "active" | "cooling" | "revoked" | "not-mining";
  pool: "verified" | "unverified"; // unverified when taskId is 0
  taskId: number | null;          // null when unverified
  weight: bigint;                 // verifWeight or unverWeight, by pool
  weightWithoutBonus: bigint;     // bstar × mult; equals weight with no bonus
  holdsBonus: boolean;            // optimal and bonus > 0
  miningSince: bigint;            // `since`
  readAt: { chainId: 56; block: bigint; time: bigint };
}
```

- **Status mapping:** contract 0 → `not-mining`, 1 → `active`, 2 → `revoked`, 3 → `cooling`. A cooling miner has stopped but can still claim for 1,200 blocks.
- **Bonus changes:** a miner can lose its bonus (`Demoted`) and win it back (`Reclaimed`). The reader follows both.
- **Not active means earning nothing:** a `cooling`, `revoked` or `not-mining` miner has `weight` 0, `weightWithoutBonus` 0 and `holdsBonus` false. The contract zeroes a stopped or revoked miner's weights, even though other fields keep their old values (`docs/decisions/2026-11-19-chain-readers.md`).
- **No image field:** sampled miners have an empty `tokenURI`. The app shows a two-letter badge.

### `NetworkState`

```ts
interface NetworkState {
  verifiedWeight: bigint;    // totalVerifWeight
  unverifiedWeight: bigint;  // totalUnverWeight
  minerCount: bigint;
  verifiedMinerCount: bigint;
  readAt: { chainId: 56; block: bigint; time: bigint };
}
```

### `Valuation`

```ts
type Scenario<T> = { low: T; base: T; high: T };

interface Valuation {
  minerKey: Hex32;
  pool: "verified" | "unverified";
  window: { from: bigint; to: bigint; label: "30d" | "to-2030-halving" };
  range: Scenario<bigint>;                   // BEM base units; low ≤ base ≤ high
  inputs: {
    minerWeight: Scenario<Sourced<bigint>>;  // low uses weightWithoutBonus
    networkWeight: Sourced<bigint>;
    growthPpm: Scenario<Sourced<bigint>>;    // network weight growth a day
    emissionRate: Sourced<bigint>;           // base units a second
  };
  model: {
    version: string;
    backtest: "pending" | { coverage: string; ref: string };
  };
}
```

- **Ordering:** the parser refuses a range that is not ordered low ≤ base ≤ high, and miner weight the same. Growth is ordered the other way (low ≥ base ≥ high): the low case assumes the fastest growth.
- **Negative growth:** `growthPpm` may be negative (the network shrinks), but must be above −1,000,000 ppm (−100% a day). On the wire it is a decimal string with an optional minus sign.
- **Window labels on screen:** "30 days" and "until the 2030 halving". Never "lifetime".

### `Price`

```ts
interface Price {
  usdPerBem: bigint;  // 8 decimals: 2,050,000,000 is $20.50
  source: string;     // which feed
  readAt: bigint;     // Unix seconds
}
```

A price of zero is refused (a broken feed). Shown only as a dollar figure beside a BEM value, with its age. Stale after one hour (the app greys it out). Never an input to a valuation or a ranking.

### `Offer`

*Decided in `docs/decisions/2026-11-19-offer-shape.md`, following the venue decisions (`2026-11-19-offer-venues.md`, `2026-11-19-sell-without-bids.md`).*

```ts
type Currency = "BNB" | "OKB" | "BEM";            // BNB and OKB: 18 decimals; BEM: 8
type Amount = { currency: Currency; value: bigint };
type Venue = "bnb-market" | "xlayer-market" | "tapepool";
type ChainRead = { chainId: 56 | 196; block: bigint; time: bigint };

type Comparable = { price: Amount; weight: bigint; readAt: ChainRead; tx?: Hex32 }; // tx on sales only
type Comparables = { venue: Venue; rule: string; items: Comparable[] };

type SellBid =
  | { state: "live"; venue: Venue; readAt: ChainRead; price: Amount; expiresAt: bigint | null }
  | { state: "none"; checkedAt: bigint };

type Offer =
  | { option: "sell"; minerKey: Hex32; bid: SellBid; sales: Comparables; asks: Comparables }
  | { option: "rent"; minerKey: Hex32; state: "no-venue" }
  | { option: "rent"; minerKey: Hex32; state: "none"; checkedAt: bigint }
  | { option: "lend"; minerKey: Hex32; state: "live"; venue: "tapepool"; readAt: ChainRead;
      receivedNow: Amount; fee: Amount; termDays: 7 | 14; repayment: "from-output-until-paid" }
  | { option: "lend"; minerKey: Hex32; state: "none"; checkedAt: bigint };
```

- **No offer is a state, never a zero.** A bid, sale, ask or advance of 0 is refused.
- **Rent today is always `no-venue`:** no rental market exists. There is no live Rent shape until one does.
- **Sell with no bid** still carries `sales` and `asks` of comparable miners. Each list has a `rule` saying how they were picked, shown on screen. The bid headline stays "no bid right now".
- **Currencies:** every amount names its currency. Sell prices on the BNB market are BNB, on the X Layer market OKB. A Lend advance and its fee are BEM. Conversion to BEM for comparison happens on screen, at today's prices, labelled.
- **Chains:** each venue is on one chain (BNB market 56; X Layer market and TapePool 196). A read from the wrong chain is refused.
- **Weights:** comparables carry the comparable miner's weight (never 0), so the screen can show price per unit of weight.
- **Hold is not an offer:** it comes from the `Valuation`.
- **Unclaimed rewards move with the NFT when it's sold:** a Sell is always shown with "claim first".

### `CircuitRef` (provisional)

```ts
interface CircuitRef {
  chainId: 56 | 196;
  processor: Address;        // the processor contract (the circuit's NFT collection)
  tokenId: bigint;           // the circuit's id on that processor
  tapedOutAt: { block: bigint; txIndex: number; logIndex: number; time: bigint };
  tapedOutBy: Address;       // the owner in the processor's TapedOut event
  designCommittedAt: bigint | null; // block of the design commitment the mining contract accepted for this circuit (the miner's commitBlock); null when there is none. Only miners can have one
}
```

- **Design time:** `designCommittedAt` when it is set and before `tapedOutAt.block`, otherwise `tapedOutAt.block`.
- **Order:** a circuit is earlier than another when its design time is earlier. Same block: the lower `tapedOutAt` (block, then transaction index, then log index) is earlier. The earliest proven design is the original (`2026-11-20-verdict-scope-and-earliest-design.md`, decision 4).
- **Miner link:** a miner's key is `keccak256(abi.encodePacked(processor, tokenId))` (`docs/notes/2026-11-18-mining-contract-findings.md`).
- **Where it comes from:** `tapedOutAt` and `tapedOutBy` come from the processor's `TapedOut(uint256 indexed id, address indexed owner, uint32, uint32)` event (`docs/notes/2026-11-20-netlist-storage.md`). `designCommittedAt` comes from `getMiner(key).commitBlock` on the mining contract, re-checkable against the `DesignCommitted` event in that block (`docs/notes/2026-11-20-what-can-mine.md`).

### `Originality` (provisional)

```ts
type OriginalityVerdict =
  | { verdict: "wrapper"; pointsTo: CircuitRef[]; finalTargets: CircuitRef[]; chainSteps: number } // netlist is only REF records; pointsTo is every distinct direct target; finalTargets is every circuit where a chain ends (the first with gates of its own); chainSteps counts the longest branch, at most 10
  | { verdict: "copy"; of: CircuitRef; netlistHash: Hex32; bytesIdentical: boolean; earlierBy: "tape-out" | "commitment" } // same netlist hash as a circuit with an earlier design time, at or above the size floor; bytesIdentical is false when they match only once NAND inputs are sorted; earlierBy says what made "of" earlier
  | { verdict: "too-small-to-tell"; sameAs: number; earliest: CircuitRef; netlistHash: Hex32; gateCount: number; floor: number } // identical, below the size floor
  | { verdict: "no-earlier-copy"; netlistHash: Hex32 }
  | { verdict: "cant-check"; reason: "netlist-unreadable" | "outside-index" | "read-failed" | "ref-chain-too-long" };

type OriginalityFact =
  | { fact: "tape-out-address"; same: boolean }                      // beside "copy": the earlier circuit was taped out by the same address, or not
  | { fact: "uses-ref"; refRecords: number; targets: CircuitRef[]; borrowedGates: number; totalGates: number } // REF records mixed with real gates
  | { fact: "also-identical"; to: CircuitRef; netlistHash: Hex32 }   // beside "wrapper": also identical to an earlier circuit
  | { fact: "can-mine"; state: "mining" }                            // every result carries exactly one can-mine fact
  | { fact: "can-mine"; state: "cant-mine"; reasons: CantMineReason[] } // every reason that applies, at least one
  | { fact: "can-mine"; state: "stopped"; stoppedAt: bigint; canStartFrom: bigint } // cooling: stopBlock, and stopBlock + 1,200
  | { fact: "can-mine"; state: "not-started" }                       // nothing rules it out; never a promise that it passes a task
  | { fact: "design-bonus"; holds: boolean; bonus: bigint };         // miners only, from getMiner (optimal, bonus); shown before the verdict

type CantMineReason =
  | { reason: "processor-not-eligible" }                             // processorMultiplier is 0
  | { reason: "uses-ref" }                                           // the netlist has a REF record
  | { reason: "failed-test-vector"; taskId: number; vectorIndex: number; block: bigint }; // revoked, from the Revoked event; it can never start again

interface Originality {
  circuit: CircuitRef;
  scope: "miner" | "listed" | "pasted"; // why it was checked; only "miner" and "listed" are published
  result: OriginalityVerdict;
  facts: OriginalityFact[];
  occc: { status: "official"; collection: Address } | { status: "not-listed" } | { status: "not-checked" };
  index: { circuitsChecked: bigint; upToBlock: { chainId: 56 | 196; block: bigint } };
  ruleVersion: string;       // which version of the copy and wrapper rules produced this, including the hash rule, the size floor and the chain step limit
}
```

- **Rules:** `docs/decisions/2026-11-20-copy-and-wrapper-rules.md` as amended by `docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md`, run in this order: can't check → wrapper → copy or too small to tell → no earlier copy found.
- **Who gets a result:** every miner and every circuit listed on TapeOut's circuit market; anything else pasted into the app is checked on screen with `scope: "pasted"` and never published.
- **Netlist hash:** `keccak256(abi.encodePacked(uint32 nIn, uint32 nOut, bytes sorted))`, where `sorted` is the netlist with each NAND record's two inputs in ascending order and LATCH and REF records unchanged. A copy with swapped inputs matches; the same bytes with a different `nIn` or `nOut` don't. The byte hash is the same encoding with the bytes as stored, kept as evidence (`bytesIdentical`). Code: `packages/originality/src/hash.ts`.
- **Wrapper chains:** followed for at most 10 steps on the longest branch; past that the verdict is `cant-check` with `ref-chain-too-long` (`docs/decisions/2026-11-20-wrapper-targets-and-step-limit.md`).
- **Stated limit:** "Checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn't detected." Shown with every `copy` and `no-earlier-copy`.
- **Can mine:** the states and their wording are in `docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md`. A revoked miner's evidence is its `Revoked` event; a stopped miner's is `getMiner`'s `stopBlock` and its `Stopped` event.
- **Contract first for miners:** a miner's `design-bonus` fact is shown before Foreman's verdict, each labelled with its source. Neither overrides the other.
- **Never "original":** `no-earlier-copy` is shown as "No earlier copy found among N BNB Chain circuits checked, up to block B", using `index`. A circuit taped out after the index's last block is caught up first; one still outside the index is `cant-check` (`docs/decisions/2026-11-20-circuit-index.md`).
- **Too small to tell:** shown as "Identical to N earlier circuits; too small to tell", with the floor stated. The floor is measured from the index, not chosen; until it is, no `copy` verdict is issued.
- **Evidence travels with the verdict:** a `copy` names the earlier circuit, both design times (tape-out or commitment block) and the shared hash; a `wrapper` names what its REF records point to and where each chain ends. Nothing else is needed to re-check it from chain data.
- **Facts are not verdicts:** an `OriginalityFact` adds context ("taped out by the same address", "1,204 of its 1,209 gates come from other circuits") and never changes the verdict.
- **Value is separate:** an `Originality` never changes a `Valuation`. There is no copy discount.

### `PublishedResult` (provisional)

```ts
interface PublishedResult {
  originality: Originality;
  publishedAt: { chainId: 196; block: bigint; tx: Hex32 };
  contract: Address;         // Foreman's results contract on X Layer, once deployed and listed in "On-chain facts"
}
```

- **Only miners and listed circuits:** a result with `scope: "pasted"` is never published.
- **Reproducible:** what is written on chain includes the verdict, its evidence, `ruleVersion` and `index.upToBlock`, so anyone can recompute it.
- **The on-chain encoding** is decided with the results contract.
