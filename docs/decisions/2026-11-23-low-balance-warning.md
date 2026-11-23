# The publisher wallet's balance on GET /health, with a low-balance warning

- **Date:** 23 November 2026
- **Status:** Accepted
- **Decided by:** William, 23 Nov 2026, choosing "Balance check + 503" over a warning line only
- **Builds on:** `2026-11-23-hosting.md`, decisions 4 (the worker publishes to the testnet every run) and 7 (failures show on `GET /health`)

## Context

The hosted worker pays X Layer testnet gas from the publisher wallet `0x2ef2…49ef` on every run that publishes. When the wallet can't pay, the node refuses the transaction ("insufficient funds") and the publish stage records a failure. Nothing is lost, and the next run tries again. But:

- `/health` only turns 503 after 30 minutes without a finished publish;
- nothing warns before the wallet is empty.

Measured on 23 Nov 2026: the first hosted publish (61 results, one transaction) used 5,053,929 gas at 0.02 gwei, 0.000101 OKB. The wallet held 0.558 OKB, about 5,500 such transactions. Most runs publish nothing.

## Decision

1. **Every publish run reads the publisher's balance** before anything else, including runs with nothing to send. Each read is stored with the chain, the address and the time it was read (`publisher_balance`, migration 014). A failed read is logged and doesn't stop the publish.
2. **Below 0.05 OKB the balance is low.** That's about 500 publishes at 23 Nov prices. The publish stage logs a warning line, and on `/health`:
   - the publish stage's health is `"low-balance"`;
   - the whole is `"low-balance"`, answering **503**, unless a stage is behind, which wins.
3. **`/health` shows the publisher**: its address, its balance in OKB, when it was read and the threshold. While publishing is off (no key), the balance isn't judged.
4. **An uptime checker carries the warning to William.** A free checker on `/health` emails when it answers 503 (hosting ADR, decision 7). Telegram stays with the copy alert notifications, on the cut list.

## Consequences

- A wallet with too little gas shows within one run, not after 30 minutes: it is under the threshold before it is empty.
- The threshold is a constant in the code (`LOW_BALANCE_WEI`). Changing it is a code change.
- The balance is public chain data. It's stored and shown; the key never is.
