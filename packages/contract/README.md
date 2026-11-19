# @foreman/contract

The data contract's types and parsers: the shapes that the chain readers, the valuation engine, the API, the web app and the agent loop all share.

- **Shapes and their status:** [`docs/data-contract.md`](../../docs/data-contract.md)
- **Why they look this way:** [`docs/decisions/2026-11-19-data-contract.md`](../../docs/decisions/2026-11-19-data-contract.md)
- **Owner:** Furqaan. A field you need that is not in the contract is a note to him, not a local addition. Never widen a shape quietly.

## The one rule

**A value that does not match the contract is an error, never a zero or a default.**

Every parser throws `ContractParseError` on bad input. Catch it at the edge: an API handler returns 400, a reader stops and reports it, and the app shows "couldn't read this". Never catch it and substitute a value. A silent zero on a valuation or an offer is the bug Foreman exists to prevent (CLAUDE.md, "Tests that are not optional").

## Install

It's a workspace package. From another package in the repo:

```jsonc
// package.json
"dependencies": { "@foreman/contract": "workspace:*" }
```

```ts
import { parseUint, parseSourced, ContractParseError } from "@foreman/contract";
```

The package ships TypeScript source (`exports` points at `src/index.ts`), like `@foreman/valuation`. There's no build step.

## Wire format

Types use `bigint` for every amount, weight, time and block. JSON has no `bigint`, so on the wire each one is a **decimal string of base units**.

| Kind | In TypeScript | On the wire | Example |
| --- | --- | --- | --- |
| Token amount | `bigint`, base units (BEM: 8 decimals) | Decimal string | `"5169000000"` is 51.69 BEM |
| Weight | `bigint` | Decimal string | `"1609667"` |
| Time | `bigint`, Unix seconds | Decimal string | `"1787318132"` |
| Block | `bigint` | Decimal string | `"134351215"` |
| Rate in parts per million | `bigint` (10,000 = 1%); may be negative | Decimal string | `"4000"` is 0.4%, `"-2000"` is −0.2% |
| Address | `Address` | Lowercase `0x` hex, 20 bytes | `"0x7e2e…7b46"` |
| Miner key, transaction hash | `Hex32` | Lowercase `0x` hex, 32 bytes | `"0x0508…843f"` |
| Chain id | `ChainId` (`56` or `196`) | JSON number | `56` |

**Why strings, not JSON numbers:** a JSON number loses precision above 2^53 without any error. Weights times the mining contract's 1e27 accumulator pass that easily.

**Why so strict:** each value has exactly one spelling on the wire, so two parts of Foreman can never disagree about what a value means. `parseUint` refuses:

| Refused | Why |
| --- | --- |
| `""` | `BigInt("")` is `0n`: the silent zero |
| `" 12"`, `"12 "` | Padding |
| `"-1"`, `"+1"` | Signs: every wire integer is zero or more |
| `"0x10"` | `BigInt` accepts hex; the wire is decimal |
| `"1.5"`, `"1e3"` | Not whole base units |
| `"007"` | Leading zeros: write `"7"` |
| `5169000000` | A JSON number, not a string |

Addresses and keys must be **lowercase**. Checksummed (mixed case) addresses are refused, not normalised. Lowercase them where they enter Foreman (viem's `getAddress(...).toLowerCase()`, or `.toLowerCase()` on a value you already trust).

## What's built

| Export | What it does | Status |
| --- | --- | --- |
| `parseUint(wire, field)` | Decimal string → `bigint` | Built, tested |
| `serialiseUint(value, field)` | `bigint` → decimal string; refuses negatives | Built, tested |
| `parseAddress(wire, field)` | Lowercase 20-byte hex → `Address` | Built, tested |
| `parseHex32(wire, field)` | Lowercase 32-byte hex → `Hex32` | Built, tested |
| `parseChainId(wire, field)` | `56` or `196` → `ChainId` | Built, tested |
| `parseSourced(wire, field, parseValue)` | A value with its source → `Sourced<T>` | Built, tested |
| `serialiseSourced(sourced, field, serialiseValue)` | `Sourced<T>` → wire object | Built, tested |
| `ContractParseError` | The one error every parser throws; `.field` names the bad field | Built |
| `parseMiner`, `serialiseMiner` | `Miner`, with its consistency checks (below) | Built, tested |
| `parseNetworkState`, `serialiseNetworkState` | `NetworkState`; verified miners never outnumber miners | Built, tested |
| `BnbRead` | Where a BNB Chain read happened: chain 56, block, block time | Built, tested through `Miner` and `NetworkState` |
| `parseValuation`, `serialiseValuation` | `Valuation`, with its ordering checks (below) | Built, tested |
| `parsePrice`, `serialisePrice` | `Price`; a zero price is refused | Built, tested |
| `Scenario<T>` | `{ low, base, high }` | Built |
| `parseOffer`, `serialiseOffer` | `Offer`: Sell (bid, sales, asks), Rent (`no-venue` or `none`), Lend (TapePool advance or `none`) | Built, tested |
| `Policy`, `AgentKey` | — | After the owner wallet decision (provisional in the contract) |
| `TapeOutResult`, `ActionLogEntry` | — | With the rules compiler and the agent loop |

Each shape is added one at a time, test first, with a parse and serialise pair.

## `Address` and `Hex32` are branded

`Address` and `Hex32` are `` `0x${string}` `` with a brand, so only the parsers can make one:

```ts
const key: Hex32 = "0x0508…";             // type error
const key = parseHex32(wire, "minerKey"); // ok: checked
```

A miner key can't be passed where an address is expected, or the other way round. Both are hex strings, so without the brand the compiler couldn't tell them apart.

## `Sourced<T>`: where a number came from

Every input to a valuation says where it came from. This is the trust rule "no chain data, no number" written as a type:

```ts
type Sourced<T> =
  | { value: T; source: "chain"; chainId: 56 | 196; block: bigint }
  | { value: T; source: "constant"; ref: string }      // "PodMining.INITIAL_RATE"
  | { value: T; source: "assumption"; basis: string }; // "growth measured over the last 14 days"
```

`parseSourced` takes the parser for the value inside, so it works for any type:

```ts
const networkWeight = parseSourced(body.inputs.networkWeight, "inputs.networkWeight", parseUint);

if (networkWeight.source === "chain") {
  show(`${networkWeight.value} at block ${networkWeight.block}`);
}
```

On the wire:

```json
{ "value": "1609667", "source": "chain", "chainId": 56, "block": "134351215" }
{ "value": "8333333", "source": "constant", "ref": "PodMining.INITIAL_RATE" }
{ "value": "4000", "source": "assumption", "basis": "growth measured over the last 14 days" }
```

**It is refused when:**
- `source` is missing or unknown. There is no `"model"` source: no number shown to an owner comes from a model call.
- A chain value has no block, or comes from a chain Foreman doesn't read.
- A constant has no `ref`, or an assumption has no `basis` (empty or blank text counts as missing).

## `Miner`: checks beyond the field types

The reader sends what it read from `getMiner`. The parser also refuses a miner whose fields contradict each other. The valuation's low case uses `weightWithoutBonus`, so a mistake there would quietly give a wrong range.

| Refused | Why |
| --- | --- |
| `pool: "verified"` with `taskId` `null` or `0` | The contract's task 0 means "no task", which is the unverified pool |
| `pool: "unverified"` with a task | Same rule, the other way round |
| `holdsBonus: false` with `weightWithoutBonus ≠ weight` | With no bonus, weight is `bstar × mult` either way |
| `holdsBonus: true` with `weightWithoutBonus ≥ weight` | Holding the bonus means it adds weight |
| `holdsBonus: true` on an unverified miner | Only the verified pool has a bonus |
| `readAt.chainId` other than `56` | Mining runs on BNB Smart Chain. A miner "read" on X Layer is a reader bug |
| A status other than `active`, `cooling`, `revoked`, `not-mining` | Those are the contract's four states (0 → `not-mining`, 1 active, 2 revoked, 3 cooling) |

`serialiseMiner` and `serialiseNetworkState` parse their own output before returning it, so the API can never send a shape the app would refuse.

## `Valuation`: the range has to mean something

| Refused | Why |
| --- | --- |
| `range` not low ≤ base ≤ high | CLAUDE.md's valuation tests require it; a range out of order means nothing to an owner |
| `minerWeight` not low ≤ base ≤ high | The low case can only drop the bonus, never add weight |
| `growthPpm` not low ≥ base ≥ high | **Reversed on purpose:** the low case assumes the *fastest* network growth, because a bigger network means a smaller share |
| `growthPpm` at or below −1,000,000 | −100% a day: the whole network gone. Negative growth above that is fine (miners stop and are revoked) |
| `window.to` not after `window.from` | An empty window has no value |
| `window.label` other than `30d` or `to-2030-halving` | The two horizons in `docs/decisions/2026-11-18-valuation-model.md`. Never "lifetime" |
| `backtest` other than `"pending"` or `{ coverage, ref }` with both filled in | An owner should never see "backtested" without being able to check it |

All three cases equal is fine: until the reader supplies network history, nothing separates them.

## `Price`

US dollars per BEM at 8 decimals (`"2050000000"` is $20.50), with its source and when it was read. **A zero price is refused:** it is a broken feed, and every dollar figure would read $0.00. Showing the age and greying out after one hour is the app's job; the price is never an input to a valuation or a ranking.

## `Offer`: no offer is a state, and every amount names its currency

| Refused | Why |
| --- | --- |
| A bid, sale, ask or advance of 0 | A missing offer is `state: "none"` (or Rent's `no-venue`), never an amount of zero |
| An amount without `currency` | BNB and OKB have 18 decimals, BEM 8: a bare number could be off by 10¹⁰ |
| A Lend advance or fee not in BEM | TapePool lends BEM |
| A read from the wrong chain for its venue | The BNB market is on 56; the X Layer market and TapePool are on 196 |
| A comparable with weight 0 | There'd be no price per unit of weight |
| Sales or asks without a `rule` | The screen has to say how comparables were picked |
| A live Rent offer | No rental venue exists to read one from (`2026-11-19-offer-venues.md`) |
| A Lend term other than 7 or 14 days | TapePool's two terms |

## Errors name the full path

The `field` argument is a dotted path, and nested parsers extend it. A bad value deep inside a valuation reports exactly where it is:

```ts
try {
  parseSourced({ value: 1609667, source: "chain", chainId: 56, block: "1" }, "inputs.networkWeight", parseUint);
} catch (error) {
  if (error instanceof ContractParseError) {
    error.field;   // "inputs.networkWeight.value"
    error.message; // "inputs.networkWeight.value: expected a decimal string of base units, got number 1609667"
  }
}
```

Pass the field path from the top of the shape you're parsing. The API can return it in a 400 response as it is.

## Writing a new shape

When a shape in `docs/data-contract.md` is ready to build:

1. **Check its status.** Build a provisional shape only for the fields marked settled.
2. **Test first** (the `tdd` skill), one behaviour at a time, through `index.ts` only:
   - A valid wire value parses to the typed shape.
   - Each field that's missing or wrong is refused, and the error names its path.
   - Every rule in the shape is enforced. For example, `Valuation` requires low ≤ base ≤ high, and `Offer` has "no offer" as its own state, never a zero amount.
   - Serialise, then `JSON.stringify` and `JSON.parse`, then parse again, and you get the same value.
3. **Build it from the existing parsers** (`parseObject`, `parseUint`, `parseAddress`, `parseHex32`, `parseSourced`). Don't write a new number or hex check.
4. **Export it from `index.ts`** and update the "What's built" table above.

A change to a shape that's already built changes the contract. It needs Furqaan's sign-off and a new ADR.

## Scripts

```sh
pnpm --filter @foreman/contract test       # vitest run
pnpm --filter @foreman/contract typecheck  # tsc -p .
pnpm biome check packages/contract         # lint and format
```

## Layout

```
src/
  index.ts           public exports; import only from here
  errors.ts          ContractParseError
  wire.ts            parseUint, serialiseUint, parseSignedInt, parseAddress,
                     parseHex32, parseObject, parseOneOf, parseBoolean, parseText
  sourced.ts         Sourced<T>, parseSourced, serialiseSourced, parseChainId
  bnb.ts             BnbRead: chain 56, block, time
  miner.ts           Miner, parseMiner, serialiseMiner
  network.ts         NetworkState, parseNetworkState, serialiseNetworkState
  valuation.ts       Valuation, Scenario, parseValuation, serialiseValuation
  price.ts           Price, parsePrice, serialisePrice
  offer.ts           Offer, Amount, Comparables, parseOffer, serialiseOffer
  *.test.ts          one test file per module, through index.ts only
```

`parseObject`, `parseOneOf`, `parseBoolean`, `parseText` and `parseSignedInt` are used inside the package to build shape parsers. They aren't exported.
