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
pnpm --filter @foreman/chain-bnb record          # re-record the miner fixture from bsc-rpc.publicnode.com
pnpm --filter @foreman/chain-bnb record:history  # re-record the history fixture (last hour)
pnpm --filter @foreman/chain-bnb backfill        # daily history since 22 Aug; needs BNB_ARCHIVE_RPC_URL
```

## Dependencies

| Package | Why | Cost |
| --- | --- | --- |
| `viem` 2.57.16, pinned | Decodes `getMiner` from the verified ABI; pins calls to a block | About 30 MB installed, server side only |
| `@types/node` 24.19.2 (dev) | Types for `fetch`, `node:fs` and `console` in the recorder | Types only, no runtime code |

## Network history

The valuation's growth rates and the backtests need network weight over time.

| Function | What it does |
| --- | --- |
| `blockAtOrAfter(client, time, { after? })` | The first block at or after a Unix time. It steps back from the latest block in doubling steps, then binary searches. `after` (an earlier block) skips the stepping back |
| `readNetworkHistory(client, { from, to, every })` | A `NetworkState` at `from`, `from + every`, … up to `to`, each at the first block at or after its time. Sequential, to stay inside public RPC limits |

It samples **by time, not by block count**, because BNB Chain's block time has changed (about 0.45 s now).

**History older than a few hours needs an archive node.** `bsc-rpc.publicnode.com` serves state only about 10,000 blocks back, and refuses older reads, even headers near genesis, without a personal token. Event logs run out around early October too, so rebuilding history from events isn't possible on the free node either.

To backfill daily history since mining began:

```sh
# 1. In the repo's .env (gitignored), set an archive URL from any BNB archive provider
BNB_ARCHIVE_RPC_URL=https://...
# 2. Sample 00:00 UTC each day from 22 Aug 2026 to today (about 90 days × ~25 calls)
pnpm --filter @foreman/chain-bnb backfill
```

This writes `data/network-daily.json`: each sample is the contract's `NetworkState` on the wire. It's public chain data and safe to commit. The URL is never logged, because it carries the provider's token.

The history tests replay `fixtures/bnb-history.json`: four samples 15 minutes apart, recorded inside the public node's window (`pnpm --filter @foreman/chain-bnb record:history`). The recorder answers every "latest block" question with the first answer it got, so a replay follows the same search path.

## Next

- **Run the backfill** once `BNB_ARCHIVE_RPC_URL` is set.
- **Per-miner claim history** (`Claimed` events), for the backtest.
