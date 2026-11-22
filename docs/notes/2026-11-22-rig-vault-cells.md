# Rig vault cells: who holds a miner behind a RIG voucher

- **Date:** 22 November 2026
- **Builds on:** `2026-11-19-xlayer-market-findings.md` (RIG voucher, rig vault, `cellOf`)

## Why this was checked

Voucher #19's circuit page (`0xb102…a14c`/12814) showed the miner's BNB owner as `0xbdac…5481`, not the rig vault's address `0x48d4…17c2`. The question was whether that is the vault's own place for the miner or something unexplained.

## What the vault does

The rig vault (proxy `0x48d43345656f0f9510dc3c06cba99dff597617c2`; implementation `RigVault` at `0xeb3f0614e37d995a96fa41908de8d47a57f56463`, an exact match on Sourcify, `src/RigVault.sol`) doesn't hold miner NFTs itself.

- **One cell per miner.** On deposit, the vault deploys a minimal-proxy clone of `RigCell` at `Clones.predictDeterministicAddress(cellImpl, key)`, where `key` is the miner key, and moves the NFT into it. `cellOf(key)` returns that address.
- **Only the vault controls a cell.** `RigCell` has two functions, `pay` (send a token out) and `release` (send the NFT out), and both revert for any caller but the vault (its `vault` is set once, to the address that deployed it).
- **The vault collects the miner's BEM from the cell,** then bridges it to the voucher holder on X Layer.
- **The template can't move.** `cellImpl` is set once in `initialize` and has no setter. `cellOf` reverts if `cellImpl` isn't the vault's first `CREATE` address, so an upgrade can't quietly change where the cells are.

## Checked on chain, 22 Nov 2026

- The vault's ERC-1967 implementation slot holds `0xeb3f…6463`.
- `cellImpl()` = `0x126add4cb19aa055e2ccebba72ebde5927195ee8`, equal to the vault's `CREATE` address at nonce 1.
- `0xbdac…5481` is an EIP-1167 clone of `0x126a…5ee8` and equals `cellOf` of voucher #19's miner key (`0x25aa…979e`).
- **All 16 live vouchers** (X Layer block 76,582,265, BNB block 135,080,880): for each one, the miner named by `rigs(id)` has its NFT held by exactly `cellOf(key)`. All 16 are on the ×1 processor `0xb102…a14c`.

## What it means for Foreman

- For a miner held for a RIG voucher, the BNB owner (`ownerOf`) is its cell. The person who holds it is the voucher holder on X Layer. The circuit page already returns both (`miner.owner` and `voucher.holder`), so the data contract needs no change. The page should show the voucher and its holder, never the cell as the owner.
- A voucher holder's miners don't appear under their BNB address. The owner follow and the wallet endpoint will have to read RIG vouchers on X Layer as well.
