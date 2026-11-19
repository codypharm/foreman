# Chain readers: TypeScript with viem, one package per chain

- **Date:** 19 November 2026
- **Status:** Accepted
- **Decided by:** Furqaan
- **Depends on:** `2026-11-18-language.md` (TypeScript everywhere), `2026-11-19-data-contract.md` (the shapes readers produce)

## Context

The readers turn chain state into the contract's shapes: the BNB reader produces `Miner` and `NetworkState`; the X Layer reader will produce `Offer`. The language ADR proposed viem; the choice was left to Furqaan. `scripts/check_pod_mining.py` proved the chain can be read with hand-rolled JSON-RPC, but it decodes only event topics, not the 20-field `getMiner` struct.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **TypeScript with viem** | Decodes `getMiner` from the verified ABI; shares the contract's types and parsers; pins every call to one block; the same library the web app uses (wagmi is built on it) | A dependency: about 30 MB installed, server side only |
| B | TypeScript with `fetch` and a hand-written ABI decoder | No dependency | Decoding a 20-field struct by hand is where bugs hide; reinvents viem badly |
| C | Extend the Python script | Already works for events | Cannot share the contract's types; every check would be written twice |

## Decision

**A. TypeScript with viem**, pinned to **2.57.16** (the newest release more than two weeks old; 2.58.x was published on 19 November).

Layout: **`packages/chain-bnb`** for BNB Smart Chain; **`packages/chain-xlayer`** for X Layer when its addresses are confirmed.

How the BNB reader works:

- **One block per read.** Every call for one `Miner` (`getMiner`, `ownerOf`, the block's timestamp) is made at the same block number, so the fields cannot come from different moments.
- **Tests run on saved responses.** A recorder script saves real JSON-RPC responses for chosen miner keys at one block to a fixture file. Tests replay them through viem's `custom` transport: real decoding, no network, seconds to run (the fixture loop CLAUDE.md asks for).
- **The reader's output goes through the contract's parser** before it is returned, so a reader bug is a `ContractParseError`, never a quietly wrong `Miner`.
- **An unknown miner key is an error.** `getMiner` returns an all-zero struct for a key it has never seen; the reader throws rather than returning a miner with no processor.

## A contract clarification this forced

Reading `stop()` and `challenge()` in the verified source: when a miner stops (`cooling`) or is revoked, the contract **zeroes its weights** (`_removeWeights`) but leaves `bstar`, `mult` and, while cooling, possibly `optimal` and `bonus` as they were.

So for a miner that is **not active**, `Miner` carries `weight = 0`, `weightWithoutBonus = 0` and `holdsBonus = false`: it earns nothing now, with or without a bonus. The contract's parser enforces this. It clarifies what the fields mean; it does not add a field.

Also from the source: `stop()` sets status 3 (`cooling`), and a stopped miner stays `cooling` after the 1,200-block cooldown until its holder calls `start()` again. Status 0 (`not-mining`) is what the struct holds for a key that was never registered.

## Consequences

- viem is added to `packages/chain-bnb` only. The web app will add it with wagmi under `2026-11-18-frontend.md`.
- The fixture file holds public chain data only: miner keys, owner addresses, weights. No keys or secrets.
- Network history for the valuation's growth rates (weight over time from `Started`, `Stopped`, `Demoted`, `Reclaimed` and `Revoked` events) is the next reader after `Miner` and `NetworkState`.
- `CLAUDE.md` "Tech stack" and "Repository layout" are updated.
