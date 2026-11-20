# TapePool: who can borrow, and how a quote is worked out

- **Date:** 20 November 2026
- **Read:** X Layer (chain 196) through the public RPC `rpc.xlayer.tech`, blocks 76,432,394 to 76,432,940; TapePool's source on GitHub (`TapePool/TapePool-Dapp`, commit `f6624ed8`, pushed 20 Nov 2026, 04:02 UTC)
- **Why:** Lend is TapePool's offer (`docs/decisions/2026-11-19-offer-venues.md`). Before reading it, check what TapePool lends against, where its live contracts are, and what its quote means
- **Third party:** TapePool is another team's hackathon entry, not part of the TapeOut protocol. Its contracts are owned by one wallet and have been redeployed three times

## Summary

TapePool lends BEM against **RIG vouchers only**, never against a BNB Chain miner directly. A borrower creates a borrowing account (TapePool calls it an "agent"), deposits one or more vouchers in it, and takes one advance against all of them, repaid from the vouchers' output. TapePool's own quote calculator answers "how much can this account borrow now, and if nothing, why".

**On 20 November no voucher is deposited.** Of the 16 RIG vouchers, none is held by a TapePool borrowing account, so no miner has a TapePool quote today.

## Where TapePool lives

TapePool's deploy script (`script/Addresses.sol`) lists four deployments. The app's config points at the fourth. The fourth account factory's `pool()` returns the fourth pool.

| Deployment | Account factory | Pool | Quote calculator ("lens") | State on 20 Nov |
| --- | --- | --- | --- | --- |
| 1 | `0xC365a30740c17b93fE92581667A2d60bD4b92355` | `0xD54673E73448584E86C61f45203ab507F3F2c3eC` | — | Borrowing paused; holds 0.0012 BEM; fees 75 / 150 bps |
| 2 | `0x123B9EAaAeae5047a9E5c96e3b9C81177d57607c` | `0xFD48226e11FCFF465033305574D87bCE004314BA` | — | Not read |
| 3 | `0xCB63a96929A28b2F826cD9d5eA67b6f4D200C3B8` | `0x68c1D5e6f193cE5a5060BF7540Ae391cbC1939ca` | `0xa66148be3353D85a5b4B028862C5EE9987dd0D84` | Borrowing paused; holds 0.01 BEM. This is the pool in `2026-11-19-xlayer-market-findings.md` |
| **4 (live)** | **`0xA9014E27dD17ea30E4Fa4f71934645b9DCEF8ac8`** | **`0x1a9A9850D597D8e3a03AFae48E3ac8E2D4aeC9d7`** | **`0xFcc669BC9cCa397CB01804035D5Be981d7389ef2`** | Borrowing open; details below |

**The live pool, at block 76,432,394:**

| Item | Value |
| --- | --- |
| Owner | `0x19a953e83C4CFDffFf2Fd336f3857c52D99045ba`, a wallet (no code) |
| Upgradeable | No: the ERC-1967 implementation slot is empty. A change means a new pool, as three times before |
| Holds | 10.141 BEM |
| Fee | 25 bps for 7 days, 50 bps for 14 days, at least 0.001 BEM; no late fee |
| Smallest advance | 0.01 BEM |
| Most one borrower can owe | 4 BEM (`lendLimit` for any new borrower returns 400,000,000 base units, limited by the per-borrower cap) |
| Operating fee in OKB (`opsFee`) | 0 for both terms |
| Borrowing paused | No |

**The quote calculator checks out against the pool.** At block 76,432,940, `principalFor(pool, term, limit)` returned the largest advance whose advance plus the pool's own fee equals the limit: 0.99750623 + 0.00249377 BEM for a 1 BEM limit over 7 days, 0.99502487 + 0.00497513 over 14 days. The calculator's code (7,563 bytes) has not been matched byte for byte to the GitHub source. What it returns matches that source.

## How a quote is worked out (from the source)

`TapeLens.quote(account, term)` (term 0 is 7 days, 1 is 14 days) returns the largest advance, its fee, the operating fee in OKB, and a reason code.

1. **Blockers first,** each a reason code: the account is closed (12), it already has a loan (11), the term is wrong (13), a policy change is queued (9), borrowing is paused (7), the data feed from BNB Chain is off or settling (8), or the account holds no voucher (10).
2. **The credit policy** gives the most the account may owe for the term. It is an on-chain circuit fed with the vouchers' BNB Chain data: expected output = weight × 712,800,000,000 × days × a dilution factor (9,907 for 7 days, 9,815 for 14) × 9,950 ÷ (network weight × 10⁸). The most it may owe is 85% of that for 7 days and 80% for 14.
3. **The pool's room** caps it: its idle BEM, its borrowing cap, the 4 BEM per borrower, and its backstop.
4. **The advance** is the largest amount whose advance plus fee fits. Below 0.01 BEM the quote is 0, with the reason "denied" (6) or "no room" (14).

The other reason codes: bad voucher ids (1), emission (2), pin (3), the policy circuit failed (4), the policy disagreed with itself (5), below the smallest advance (15), above the lend limit (16). Code 0 is OK.

**A quote is per account, not per voucher.** One account can hold several vouchers and gets one quote for all of them. The 4 BEM cap is per borrower across all their accounts.

## Who holds the RIG vouchers

At block 76,432,567, `totalSupply()` was 16. Ids 3, 15 and 17 have been redeemed.

| Holder | Vouchers | Kind |
| --- | --- | --- |
| `0xC9059E0F59F40920E5BD24307eaa4DeFd81Df145` | #4 to #13 | Wallet |
| `0x571d447f4f24688eC35Ccf07f1D6993655F6aF15` | #1, #2 | Wallet (the circuit market's first owner) |
| `0xD7E004CBda24E079aA3A657Ba7f8E2915192a966` | #16, #19 | Wallet |
| `0x25f7E8568e018fD9F3F58a325b911Fa81Cb7610d` | #14 | Wallet |
| `0x011fc2C7B80e59e20c6cF1d27a29729D125f5Bf4` | #18 | A 16,306-byte contract, not a TapePool account: the live factory's `isAgent` is false, and TapePool's accounts are 45-byte clones |

No voucher is in a TapePool borrowing account of any deployment. Counting the accounts the live factory has created (`AgentCreated` since its first block, 76,074,244) wasn't finished: the public RPC serves logs 100 blocks at a time. It doesn't change the answer, which comes from who holds each voucher.

## Finding a miner's voucher

The RIG voucher has no lookup from miner key to voucher id. `rigs(id)` names each voucher's miner; on BNB Chain the rig vault holds the miner's NFT at `cellOf(key)`. With 16 vouchers, reading every `rigs(id)` and matching the key is cheap.

## What this means for Lend

- A BNB Chain miner that isn't a RIG voucher can't borrow from TapePool.
- A RIG voucher has a quote only once its holder deposits it in a TapePool account, and the quote covers everything in that account.
- Today every miner's Lend is "no offer". A live offer in the demo needs a deposited voucher.

The decision on how Foreman reads and shows this: `docs/decisions/2026-11-20-lend-from-tapepool.md`.
