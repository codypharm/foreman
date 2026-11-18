# Mining contract findings, 18 November 2026

*For Furqaan. Written while checking the valuation formula. Nothing here is in "On-chain facts" yet: adding it is your call.*

## Summary

The PoD mining contract's source is published and verified. It confirms the valuation formula's structure (the verified pool's 99% is shared by verified weight), gives the exact emission rate and halving schedule, and shows the contract is sealed. It also shows that a miner's weight can drop, which the valuation has to allow for.

## Where this comes from

| What | Value | How it was checked |
| --- | --- | --- |
| Mining contract (proxy) | `0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46` | Already in "On-chain facts". It is a 130-byte ERC-1967 proxy |
| Logic contract (implementation) | `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898` | Read from the proxy's ERC-1967 implementation slot `0x3608…2bbc` |
| Verified source | `src/PodMining.sol`, solc 0.8.24, viaIR, optimizer 50 runs | Sourcify full match (creation and runtime), verified 30 Oct 2026: `https://sourcify.dev/server/v2/contract/56/0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898` |
| Linked library | `PodNetlist` at `0xfbb661fe281112c601954abb0a3cdcc697a6e6ba` | Sourcify compilation settings. Not checked further |

State below was read with `eth_getStorageAt` on `bsc-rpc.publicnode.com` at block 134,351,215, using the storage layout Sourcify publishes.

## Confirmed

| Fact | Value | Source |
| --- | --- | --- |
| Emission rate | `INITIAL_RATE = 50e8 / 600` = **8,333,333 base units a second** (integer division) = **7,199.999712 BEM a day**, not exactly 7,200 | `currentRate()`, constants |
| Halving | Time-based, not block-based: every `HALVING_PERIOD = 126,000,000` seconds (≈ 3.995 years). Rate in era *e* is `INITIAL_RATE >> e`; zero after era 63 | `currentRate()`, `_emissionBetween()` |
| Emission start | `startTime = 1787318132` = **21 Aug 2026, 13:15:32 UTC** | Slot 0, bytes 22–29 |
| First halving | **18 Aug 2030, 21:15:32 UTC** | startTime + HALVING_PERIOD |
| Pool split | 1% (`UNVERIFIED_BPS = 100`) to the unverified pool, the rest to the verified pool, each second | `_update()` |
| Share within a pool | Pro rata by weight through a per-pool accumulator: a miner earns `verifWeight / totalVerifWeight` of the verified share. If a pool is empty, its share is never minted (`totalForgone`) | `_update()`, `_accrued()` |
| Sealed | `isSealed = true`, `tasksFrozen = true`, owner = zero address (renounced), not paused. Upgrades are permanently off (`_authorizeUpgrade` is `notSealed`), and nobody can pause, because `pause()` needs the owner | Slot 0 bytes 0–1; OZ ERC-7201 Ownable and Pausable slots |
| Claim event | `Claimed(bytes32 indexed key, address indexed to, uint256 amount)`. Matches the topic layout in "On-chain facts". **topic0 not recomputed** (no keccak tool to hand): please confirm `keccak256("Claimed(bytes32,address,uint256)")` = `0x0508a8b4…843f` | Event declaration |
| Claim recipient | Tokens mint to the circuit NFT's **current holder**; unclaimed rewards move with the NFT when it is sold | `_harvest()`, comment on `claim()` |
| Supply cap | A claim is clipped to `MAX_SUPPLY − totalSupply` (should not happen on the normal curve) | `_harvest()` |

## State at block 134,351,215

| Read | Value |
| --- | --- |
| `totalVerifWeight` | 1,609,667 |
| `minerCount` | 20,807 |
| `verifMinerCount` | 20,159 |

The brief says "a few thousand miners". The chain says about 20,800 are mining.

## Things the readers and the valuation must handle

1. **Weight is not fixed.** Verified weight `H = (b* + bonus) × P`. The bonus goes only to the current best ("optimal first") design for a task on a processor. When a better design arrives, the holder is demoted (`_demoteSlotHolder`, event `Demoted`): its bonus is set to zero for good and its weight drops to `b* × P`. A challenge with a counterexample can revoke a miner (`Revoked`) and remove its weight entirely. A miner can also be stopped (`Stopped`). The valuation's low scenario must allow for this on miners that hold a bonus.
2. **`pending(key)` understates.** It only counts rewards up to the accumulator's last update (`lastUpdate`, slot 1). The true pending amount adds this miner's share of `_emissionBetween(lastUpdate, now)`. A reader that shows pending rewards must add it, or call `poke()` off chain via `eth_call` first.
3. **Reading a miner:** `getMiner(bytes32 key)` returns the whole `Miner` struct (status, taskId, weights, bonus, optimal, since, and more). `totalVerifWeight`, `totalUnverWeight`, `accVerif`, `accUnver`, `lastUpdate`, `startTime`, `minerCount` and `verifMinerCount` are public. `minerKey(circuits, circuitId)` derives the key. This answers most of the "Still open" item on reading weight, status and pending rewards.
4. **Unverified miners** (`taskId == 0`) earn from the 1% pool by `unverWeight = b* × P`, with no bonus. A miner is in one pool or the other, never both.

## Suggested rows for "On-chain facts" (your call)

| Fact | Value |
| --- | --- |
| PoD mining logic contract (BNB Chain) | `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898`, behind the proxy above; source verified on Sourcify |
| Emission | 8,333,333 base units a second (7,199.999712 BEM a day) in era 0; halves every 126,000,000 s from 21 Aug 2026 13:15:32 UTC; first halving 18 Aug 2030 |
| Mining contract sealed | `isSealed = true`, owner renounced, not paused (block 134,351,215) |
| Claim event name | `Claimed(bytes32 key, address to, uint256 amount)`, once topic0 is confirmed |

## Still to do

- **Backtest:** compare the formula's prediction with real claims for real miners. Needs each miner's weight over time from the BNB reader (`getMiner` and `totalVerifWeight` at past blocks, or rebuilt from `Started`, `Demoted`, `Revoked` and `Stopped` events).
- Confirm topic0 for `Claimed`.
- Not read yet: how `b*`, the bonus and `P` are set at `start()`, and whether copied or wrapper circuits earn (the copy discount). The answer is in `start()` and the design commitment logic.
