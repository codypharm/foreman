# @foreman/chain-bnb

The BNB reader: it reads the PoD mining contract on BNB Smart Chain into the data contract's `Miner` and `NetworkState`. **Read only:** it never sends a transaction and never needs a key.

- **Decision:** [`docs/decisions/2026-11-19-chain-readers.md`](../../docs/decisions/2026-11-19-chain-readers.md)
- **Shapes it produces:** [`docs/data-contract.md`](../../docs/data-contract.md), parsed by [`@foreman/contract`](../contract/README.md)
- **Owner:** Furqaan

## Use

```ts
import { createPublicClient, http } from "viem";
import { readMiner, readNetworkState, UnknownMinerError } from "@foreman/chain-bnb";
import { parseHex32 } from "@foreman/contract";

const client = createPublicClient({ transport: http("https://bsc-rpc.publicnode.com") });
const blockNumber = await client.getBlockNumber();

const network = await readNetworkState(client, { blockNumber });
const miner = await readMiner(client, parseHex32(key, "key"), { blockNumber });
```

**Pass the same `blockNumber` to both.** A valuation divides the miner's weight by the network's, so the two have to come from the same block.

## What each read does

| Function | Calls (all at `blockNumber`) | Returns |
| --- | --- | --- |
| `readMiner(client, key, { blockNumber })` | `getMiner(key)`; `ownerOf(tokenId)` on the miner's processor; the block's timestamp | `Miner` |
| `readNetworkState(client, { blockNumber })` | `totalVerifWeight`, `totalUnverWeight`, `minerCount`, `verifMinerCount`; the block's timestamp | `NetworkState` |

How `getMiner` maps to `Miner`:

| `Miner` field | From the chain |
| --- | --- |
| `processor`, `tokenId` | `circuits`, `circuitId` |
| `owner` | `ownerOf(circuitId)`: the current NFT holder, where claims mint to |
| `status` | 0 `not-mining`, 1 `active`, 2 `revoked`, 3 `cooling` |
| `pool`, `taskId` | `taskId` 0 is unverified (`taskId: null`); anything else is verified |
| `weight` | `verifWeight` or `unverWeight` by pool; **0 when not active** |
| `weightWithoutBonus` | `bstar × mult`; **0 when not active** |
| `holdsBonus` | `optimal` and `bonus > 0`, only when active |
| `miningSince` | `since` |

Every `Miner` and `NetworkState` goes through the contract's parser before it's returned. So the contract's checks run against real chain data, for example "a bonus holder weighs more with the bonus".

## Errors

| Error | When |
| --- | --- |
| `UnknownMinerError` | The mining contract has no miner under that key (`getMiner` returns an all-zero struct). Never shown as a miner with zero weight |
| `ChainReadError` | The chain returned something the verified source says can't happen: an undefined status, or a stopped or revoked miner that still has weight. Stop and investigate; don't work around it |
| `ContractParseError` | The mapped result breaks a contract rule. That's a reader bug |

## Tests run on saved chain data

The tests replay real JSON-RPC responses from [`fixtures/bnb-134480825.json`](fixtures/bnb-134480825.json), recorded at BNB block 134,480,825 on 19 November 2026. They don't use the network and run in milliseconds. The replay client fails on any call that wasn't recorded, so a test can never reach the network without anyone noticing.

The expected values in the tests were read **independently** with raw `eth_call` and a separate decoder, not taken from the reader's own output.

| Fixture miner | Why it's there |
| --- | --- |
| `0x5f71…6cf9` | Verified, no bonus: weight 124 |
| `0x146f…9fdb` | Holds the bonus: (59 + 336) × 6 = 2,370, or 354 without |
| `0x0000…0001` | Never registered: `UnknownMinerError` |

**Not covered yet:** a real `cooling` or `revoked` miner. There were no `Stopped` events in the 12,000 blocks before the fixture block. When one turns up, add its key to `scripts/record-fixture.ts` and record again.

To add a miner or move to a new block:

```sh
pnpm --filter @foreman/chain-bnb record   # reads a live node; edit KEYS and BLOCK in scripts/record-fixture.ts first
pnpm --filter @foreman/chain-bnb test
```

## Scripts

```sh
pnpm --filter @foreman/chain-bnb test       # vitest run, against the fixture
pnpm --filter @foreman/chain-bnb typecheck  # tsc -p .
pnpm --filter @foreman/chain-bnb record     # re-record the fixture from bsc-rpc.publicnode.com
```

## Dependencies

| Package | Why | Cost |
| --- | --- | --- |
| `viem` 2.57.16, pinned | Decodes `getMiner` from the verified ABI; pins calls to a block | About 30 MB installed, server side only |
| `@types/node` 24.19.2 (dev) | Types for `fetch`, `node:fs` and `console` in the recorder | Types only, no runtime code |

## Next

- **Network history** for the valuation's growth rates: weight over time from `Started`, `Stopped`, `Demoted`, `Reclaimed` and `Revoked` events, read in 200-block chunks (CLAUDE.md, "RPC notes").
- **Per-miner claim history** (`Claimed` events), for the backtest.
