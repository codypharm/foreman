# Foreman data contract

*The shapes every part of Foreman shares. Owned by Furqaan; decided in `docs/decisions/2026-11-19-data-contract.md`. Types and parsers live in `packages/contract`. Code against this; a field you need that is not here is a note to Furqaan, not a local addition.*

**Status of each shape:** **Settled** means build against it. **Provisional** means the shape holds but fields may change when a named fact is confirmed.

| Shape | Status | Written by | Read by |
| --- | --- | --- | --- |
| `Sourced<T>` | Settled | Everyone | Everyone |
| `Miner` | Settled | BNB reader | Valuation, API, app |
| `NetworkState` | Settled | BNB reader | Valuation, API, app |
| `Valuation` | Settled | Valuation engine | API, app, agent loop |
| `Price` | Settled | API job | App |
| `Offer` | Provisional: venue fields wait for the X Layer addresses | X Layer reader | Option ranking, app, agent loop, paper run |
| `Policy` | Provisional: rule kinds may grow with the rules compiler | AI rules drafting, confirmed by the owner | Rules compiler, app, agent loop, paper run |
| `TapeOutResult` | Settled | Rules compiler | App, action log |
| `AgentKey` | Provisional: waits for the owner wallet route | Owner wallet module | App, agent loop |
| `ActionLogEntry` | Settled | Agent loop, owner wallet module | App, Telegram bot |

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

### `Offer` (provisional)

```ts
type Venue = "xlayer-market" | "tapepool";
type Read = { chainId: 196; block: bigint; time: bigint };

type Offer =
  | { option: "rent"; state: "live"; minerKey: Hex32; venue: "xlayer-market"; readAt: Read;
      bemPerDay: bigint; days: number; expiresAt: bigint | null }
  | { option: "lend"; state: "live"; minerKey: Hex32; venue: "tapepool"; readAt: Read;
      receivedNow: bigint; repayment: "from-output-until-paid" }
  | { option: "sell"; state: "live"; minerKey: Hex32; venue: "xlayer-market"; readAt: Read;
      bid: bigint; expiresAt: bigint | null }
  | { option: "rent" | "lend" | "sell"; state: "none"; minerKey: Hex32; checkedAt: bigint };
```

- **No offer:** a missing offer is `state: "none"`, never an amount of zero.
- **Hold:** Hold is not an offer. It comes from the `Valuation`.
- **Unclaimed rewards:** they move with the NFT when it is sold. A Sell offer is always shown with "claim first".
- **Waiting on X Layer addresses:** the RIG, rental and TapePool contract addresses must be in "On-chain facts" before these fields are final.
- **Offer history:** saved from the day the reader starts.

### `Policy` (provisional)

```ts
type Rule =
  | { id: number; kind: "rent"; maxDays: number; minBemPerDay: bigint | null; mustBeatHold: boolean }
  | { id: number; kind: "lend"; maxReceived: bigint }
  | { id: number; kind: "sell-floor"; floor: bigint }; // alerts only, see below

interface Policy {
  rules: Rule[];          // ordered; ids are what the owner sees ("Rule 1")
  confirmedAt: bigint | null;  // null until the owner confirms; never taped out while null
}
```

- **Who writes what:** the AI model only drafts a `Policy`. The plain-words read-back comes from fixed templates over the typed rules. The allowed and refused examples come from running live offers through the policy in code.
- **What the rules circuit covers:** Rent and Lend rules only. **An agent key can never sell.** `sell-floor` triggers an alert, and the owner signs any sale.

### `TapeOutResult`

```ts
interface TapeOutResult {
  circuit: Address;            // the rules circuit
  chainId: 196;
  gateCount: number;
  inputsTested: bigint;
  coverage: "exhaustive" | "fixed-set";
  tx: Hex32;
}
```

### `AgentKey` (provisional)

```ts
interface AgentKey {
  id: Hex32;
  ownerWallet: Address;
  rulesCircuit: Address;
  allowed: ("rent" | "lend")[];  // never "sell"
  movesPerDay: number;
  expiresAt: bigint;
  state: "active" | "expired" | "revoked";
  movesToday: number;            // refused moves count
}
```

- **Revoke:** the key stops working as soon as the revoke transaction is confirmed.
- **Waiting on the owner wallet route:** our own module, or TapeOut's account system.

### `ActionLogEntry`

```ts
type ActionLogEntry = {
  minerKey: Hex32;
  at: bigint;                  // Unix seconds
  decidedAtBlock: { chainId: 196; block: bigint };
} & (
  | { kind: "done" | "refused";
      what: string;            // "Rent 3F for 30 days at 1.98 BEM a day"
      offer: Offer;            // the live offer it acted on
      rule: { id: number; text: string } | null;
      circuit: { address: Address; answer: "yes" | "no" };
      tx: Hex32;               // refused moves have one too: the wallet emits Refused and moves nothing
      alternatives: { option: "hold" | "rent" | "lend" | "sell"; bem30d: bigint | null }[] }
  | { kind: "alert"; what: string; offer: Offer; rule: { id: number; text: string } }
  | { kind: "key"; event: "issued" | "expired" | "revoked"; keyId: Hex32; tx: Hex32 | null }
  | { kind: "setup"; event: "tape-out" | "paper-run"; ref: string }
);
```

- **Alternatives:** `alternatives` is the option ranking at the moment of the move, recorded by the agent loop. It never changes afterwards. An option with no offer has `bem30d: null`.
- **Refused moves:** a refused move counts toward the daily limit and is never retried, so there is no "retried" field.
