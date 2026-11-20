# Lend: TapePool's own quote, or no offer with the reason

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William (option a below, the recommended one; the file list and the contract change were shown before writing)
- **Builds on:** `2026-11-19-offer-venues.md` (Lend is TapePool), `2026-11-19-offer-shape.md` (the Lend shape)
- **Evidence:** `docs/notes/2026-11-20-tapepool-lend.md`

## Context

TapePool lends BEM against RIG vouchers deposited in a borrowing account, never against a BNB Chain miner directly. One account can hold several vouchers and gets one quote for all of them, and each borrower can owe at most 4 BEM. On 20 November none of the 16 vouchers is deposited, so no miner has a quote.

The `Offer` shape had one Lend offer per miner, with a 7- or 14-day term, and a "none" that couldn't say why. A screen showing "no offer" for every miner, with no reason, reads like a broken reader.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **a** | **Read TapePool's own quote; otherwise "no offer" with the reason** | The offer is TapePool's real answer, read from its contracts at a block. The reasons explain why most miners have none | Every miner shows "no offer" until someone deposits a voucher. Needs an X Layer reader and a contract change |
| b | Show Lend as "not checked" | No work before the freeze; the cut list allows it | No Lend in the demo, even after a voucher is deposited |
| c | Estimate each miner's advance from TapePool's published maths | Every voucher gets a number | It is our guess at a third party's offer. TapePool's policy, feed or room could refuse it, and an offer that isn't real breaks "missing is missing" |

## Decision

**a.**

1. **One Lend offer per term.** TapePool quotes 7 and 14 days separately, with different amounts and fees, and may refuse one and allow the other. Each miner gets two Lend offers, each `live` or `none`, each naming its term.
2. **A live offer is TapePool's quote, read from its quote calculator** (`quote(account, term)`) at one X Layer block. It shows the largest advance, the fee in BEM and the operating fee in OKB, even when that is 0. On screen: "up to", since the borrower may take less.
3. **A live offer only when the account holds just this voucher.** An account holding several gets one quote for all of them; showing it as one miner's offer would overstate it. That case is "no offer", with the reason and how many vouchers share the account.
4. **No offer always says why:**

   | Reason | When | On screen |
   | --- | --- | --- |
   | `not-a-voucher` | The miner isn't held in the rig vault as a RIG voucher | "TapePool lends only against RIG vouchers" |
   | `not-deposited` | A voucher not held by an account from TapePool's live account factory | "TapePool quotes only vouchers deposited with it" |
   | `shared-account` | The account holds this voucher and others | "This voucher shares a TapePool account with N others; its quote covers them all" |
   | `declined` | TapePool's quote returns a reason other than OK | TapePool's reason, in plain words ("borrowing is paused", "the pool has no room", "a loan is already open") |

5. **The pool is found through the account factory.** Foreman keeps one TapePool address, the live account factory. The pool and the quote calculator come from reads at the same block: the factory's `pool()`, and the pool and account it is asked about. If TapePool redeploys, the factory's `pool()` won't change, so a new factory is a new entry in On-chain facts, made by hand. The reader refuses to quote through a pool that doesn't match the factory.
6. **The voucher for a miner** is found by reading every live voucher's `rigs(id)` and matching the miner key (16 vouchers today). A voucher's holder is a TapePool account if the live factory's `isAgent` says so.
7. **TapePool is a third party.** Its contracts are listed in On-chain facts as third party, owned by one wallet. Foreman reads its quote and never borrows, deposits or calls a function that changes anything.

## Data contract change

The Lend offers in `docs/data-contract.md` and `packages/contract`:

```ts
type TapePoolReason =
  | "bad-ids" | "emission" | "pin" | "policy-failed" | "policy-mismatch" | "denied" | "paused"
  | "feed-off" | "policy-change-queued" | "no-collateral" | "loan-open" | "closed" | "bad-term"
  | "no-room" | "below-min-advance" | "above-lend-limit"; // TapePool's codes 1 to 16

type LendNoneReason =
  | { kind: "not-a-voucher" }
  | { kind: "not-deposited"; voucherId: bigint }
  | { kind: "shared-account"; voucherId: bigint; vouchers: number }  // vouchers ≥ 2, this one included
  | { kind: "declined"; voucherId: bigint; tapepool: TapePoolReason };

  | { option: "lend"; minerKey: Hex32; termDays: 7 | 14; state: "live"; venue: "tapepool";
      readAt: ChainRead; voucherId: bigint; receivedNow: Amount; fee: Amount; opsFee: Amount;
      repayment: "from-output-until-paid" }
  | { option: "lend"; minerKey: Hex32; termDays: 7 | 14; state: "none"; checkedAt: bigint;
      reason: LendNoneReason };
```

- **New:** `reason` on "none"; `termDays` on "none"; `voucherId` and `opsFee` (OKB, may be 0) on "live".
- `receivedNow` stays BEM and above 0. `fee` stays BEM and may be 0.
- `readAt` on a live Lend offer is on chain 196, as before.

## Consequences

- **`packages/chain-xlayer`** starts here: the miner-to-voucher match, the holder check against the account factory, and the quote. Tests on saved RPC responses, like `packages/chain-bnb`. No voucher is deposited, so there is no real live quote to record. How the live branch is tested until one exists is settled when the reader is built, and anything not recorded from mainnet is labelled as such.
- **The demo** shows a live Lend offer only if a voucher is deposited with TapePool by then: TapePool's team, or a voucher of William's. Otherwise every Lend shows its reason.
- **Rent** is unchanged: always `no-venue`.
- **Unconfirmed until checked:** the quote calculator's code hasn't been matched byte for byte to TapePool's GitHub source. Its answers match that source (`principalFor` against the pool's `fee`).
