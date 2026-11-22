# Which circuits the wallet page lists

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-api-endpoints.md` (decisions 5 and 6, `WalletMiners`), `docs/notes/2026-11-22-rig-vault-cells.md`

## Context

The owner follow and the wallet endpoint are next in the API's build order. The endpoints decision settled where a wallet's miners come from (followed `Transfer` events of the two eligible processors, plus RIG vouchers read live on X Layer), the copy alert rules and the response shape. It didn't say which of a wallet's circuits count as "your miners". Foreman stores originality results only for miners and listed circuits, so a circuit that was never started has no stored result.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Every miner it holds, in any state** | Each has a stored result and a can-mine state. An owner sees a copy alert for a miner they've stopped | A revoked miner is listed too |
| B | Only miners mining now | Shortest list | Hides stopped miners, and their alerts |
| C | Every circuit it holds | Complete | Circuits never started have no stored result: "Can't check" until the results job covers them |

## Decision

**A**, chosen by William in a grilling on 22 Nov 2026.

- **"Your miners"** are circuits on the two eligible processors that the index has as started miners, whatever their state now (mining, stopped or revoked), whose NFT the wallet holds at the owner follow's block. Each shows its stored result and its can-mine state.
- **Plus the RIG vouchers the wallet holds** on X Layer, read live at X Layer's latest block, each mapped to its miner (`heldAs: voucher`).
- **A vouchered miner's NFT sits in its rig vault cell** (`cellOf(key)`), so the owner follow records the cell as its owner. The miner reaches the page through the voucher holder, never through the cell's address.

## What follows

- The endpoints decision's "not checked yet" item is settled: a voucher maps to its miner through RIG's `rigs(id)` (processor and circuit id), and every live voucher's miner NFT was found in its cell on 22 Nov 2026 (the cells note).
- Build next, test first: the `Transfer` scan and follow of the two eligible processors, then the wallet endpoint with its copy alerts.
