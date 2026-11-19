# X Layer market findings, 19 November 2026

*For Furqaan, and William for the decision screen. The "Still open" item on X Layer addresses: what Rent, Lend and Sell offers actually exist. Read-only checks on X Layer (`rpc.xlayer.tech`, chain 196) and BNB Chain (`bsc-rpc.publicnode.com`), plus verified source on Sourcify.*

## Summary

The miner voucher (RIG) is real and confirmed on chain. **The X Layer market around it is almost empty:** 15 vouchers held by 5 wallets, no asks, no offers, no protocol rentals, and one lending pool (another team's hackathon entry) holding 0.01 BEM. As things stand, the decision screen would show "no offer" for Rent, Lend and Sell on X Layer for nearly every miner. **This is a product question, not a data one** (see "What this means").

## Confirmed on chain: the protocol's bridge

| Contract | Chain | Address | How it was confirmed |
| --- | --- | --- | --- |
| RIG voucher ("TapeOut Rig", RIG, ERC-721) | X Layer | `0x9cfc959cd42b2e1d39a0d850c528210e818ae520` (UUPS proxy; implementation `0x66fb7d52c4931b48776d9019f88f7f58fb0d85e1`, Sourcify exact match) | See below |
| Rig vault | BNB Chain | `0x48d43345656f0f9510dc3c06cba99dff597617c2` (proxy; implementation `0xeb3f0614e37d995a96fa41908de8d47a57f56463`) | `voucher()` returns the RIG address; RIG's `vault()` returns this one |
| BEM (bridged, LayerZero OFT) | X Layer | `0x60e62efa9405d6873c5deabd4e6cc91c25363952`, 8 decimals | RIG's `bem()` and `oft()`; name and symbol BEM |
| LayerZero endpoint | X Layer | `0x1a44076050125825900e736c501f859c50fe728c` | RIG's `endpoint()` |

**How RIG was tied to the protocol, not just its name.** For three live vouchers (#1, #2, #16), I took the miner each voucher names (`rigs(id)`), rebuilt its miner key, and checked three things on BNB Chain. Each is an **active** miner in the PoD mining contract. Each voucher's `power` equals that miner's on-chain weight. And the miner's NFT is held by exactly the vault cell for that key (`cellOf(key)`). X Layer has look-alike tokens using the TapeOut name, so a name alone proves nothing.

**State today:** 18 vouchers minted, 3 redeemed, **15 live**, total power 908 (against about 1.6 million verified network weight). Owner `0xb3d85b42a045c1a88d800cad0f55d2566a4d3138`: **the voucher is upgradeable by TapeOut**, unlike the sealed mining contract.

## What RIG does, from its verified source

- **One voucher = one mining miner in the BNB vault.** The miner keeps mining on BNB Chain. Its BEM is sent over LayerZero to the **voucher holder**, and the holder can redeem the miner at any time.
- **Renting was removed.** v2's notes say the "terms / split / merge / RigYield" earnings split was deleted after an audit: v1's `split` could lock a miner forever and take all its earnings. **There is no protocol-level rental on X Layer.**
- **Bridging costs about 2% of the deposit round trip** (nominal fee 0.5%, amplified by rounding), plus a redeem fee in OKB (0.0141 OKB today, per OwlGate).

## The markets that exist (third party, not protocol)

| Option | What exists | State today |
| --- | --- | --- |
| **Sell** | RIG vouchers trade as Seaport 1.6 orders (`0x0000000000000068f116a894984e2db1123eb395`, code present on X Layer) in OKB or WOKB. Orders are **signed off chain** and kept in a third-party order book; OwlGate's public API `api.owlgate.xyz/xl/market` lists them | **0 asks, 0 offers, 0 collection offers** across all 15 vouchers |
| **Rent** | Nothing found. The protocol removed it; no third-party rental contract turned up | None |
| **Lend** | **TapePool**, another entry in this hackathon ([TapePool/TapePool-Dapp](https://github.com/TapePool/TapePool-Dapp)). Borrowers move a RIG into their own agent contract and get a BEM advance for 7 or 14 days, repaid from harvests. The credit rule is a TapeOut circuit checked on chain | Live pool `0x68c1d5e6f193ce5a5060bf7540ae391cbc1939ca` (asset = bridged BEM, confirmed) holds **0.01 BEM**. Older stack `0xd54673e7…f3c3ec` holds 1e-8 BEM. Neither is verified on Sourcify; owned and upgradeable within bounds |

**Not checked:** the BNB-side secondary market for miners themselves. Community analysis talks about real secondary volume, and OwlGate runs a router on BNB (`0x8cf6…814f`) into the "TapeOut circuit market". That is probably where real Sell bids are. The old "unconfirmed" X Layer addresses (factory `0x1f09…0761`, account opener `0x536a…0106`, circuit market `0xd89f…75db`) have code, but their implementations aren't verified. TapePool's config shows `0x1f09` and `0x536a` are TapeKit/DeWEB contracts (factory and opener), not a market.

## What this means for Foreman

1. **The decision screen on X Layer alone would rank Hold against nothing.** Rent has no venue. Lend has one pool with no liquidity. Sell has an empty book.
2. **TapePool is a competitor and a partner** in the same hackathon. Its lending is exactly Foreman's "Lend" option, and it already uses a TapeOut circuit as its credit rule, which is close to our rules-circuit pitch.
3. **The agent key can't do much on X Layer today:** there is nothing to rent into, and lending is capped by the pool's liquidity.

Options, for Furqaan to choose (not decided here):

- **a. Add the BNB Chain miner market for Sell.** That's where real bids are likely to be. Then X Layer is for Lend (TapePool) and the rules circuit. It needs a look at the BNB circuit market, and a scope change because Sell would live on BNB.
- **b. Redefine Rent** as something that exists: for example, a buyer pays for the voucher and the seller buys it back later, or a TapePool advance shown as "renting out future output". This changes one of the four options, which is a team decision.
- **c. Keep the four options and show "no offer" honestly,** making the demo about valuation and the rules circuit. Partner with TapePool so its pool has liquidity by demo day. The demo story's "renting beats selling" step would have no real offer.
- **d. Become the market:** Foreman posts offers itself. **Ruled out by the product:** "Foreman never lends or rents anything itself".

## Suggested next steps

- Furqaan picks a, b or c (or a mix). It changes `docs/PRODUCT.md` and the demo story, so it gets an ADR.
- Read the BNB circuit market (where OwlGate's router sends buys) for real Sell bids.
- Ask TapePool in Telegram about liquidity by 2 December, and whether they'd quote Foreman a referral fee. This is the "partners" outreach row in the build order.

## Sources

- RIG verified source: Sourcify, chain 196, `0x66fb7d52c4931b48776d9019f88f7f58fb0d85e1`
- [TapePool/TapePool-Dapp](https://github.com/TapePool/TapePool-Dapp): `README.md`, `app/src/config.ts`
- [kvzuobai/owlgate](https://github.com/kvzuobai/owlgate): Seaport, WOKB and order book; API `api.owlgate.xyz/xl/market`, read 19 Nov 2026
- [TapeOutProtocol/TapeKit#10](https://github.com/TapeOutProtocol/TapeKit/pull/10): TapeKit's X Layer and Base addresses (DeWEB, not the market)
- TapePool terms, second-hand: [KuCoin commentary](https://www.kucoin.com/news/insight/X/6adb93813f52a20007f3ee22)
