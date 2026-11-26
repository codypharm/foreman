# No FabX miners in Your miners

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, one question with a recommended answer and its alternative
- **Extends:** `2026-11-25-fabx-copy-check.md` (decision 8, "Your miners: only after the core works end to end and before 30 November; the first thing dropped") and `2026-11-22-wallet-miners.md`. Neither is edited

## Context

FabX's core met its go criteria on the live site on 26 November 2026: a FabX miner typed into the Check box shows its verdict with evidence, and 7,145 FabX results were published to the testnet and read back.

Your miners was next. Two facts, found on 26 November 2026, set its cost and its worth:

- **FabX miners trade.** A FabX miner's NFT stays in a wallet while it mines, and the holder isn't always the wallet that registered it: for 5 of 8 miners checked at X Layer's latest block, `ownerOf` on FabX's processor differed from the registrant in FabX's miner record. Foreman doesn't store FabX's `Transfer` events. Listing a wallet's FabX miners needs a new holder index: one snapshot of all 7,168 owners, then a `Transfer` follow.
- **No copy alert is possible.** Copy alerts come from open listings on TapeOut's BNB Chain market. FabX's market isn't read, so a FabX miner on Your miners could show its verdict and can-mine state, never an alert.

## Decision

**Your miners doesn't show FabX miners.** It stays as it is: a wallet's TapeOut miners on BNB Chain and its RIG vouchers. A FabX miner's result is reached through the Check box ("FabX 1234", a miner key or the circuit) and its result page.

*Rejected:* building it before 30 November. The holder index, a `WalletMiners` change, a mock and the build would take one to two days for a list without alerts. That time goes to the phone pass with OKX Wallet, the demo video and the submission.

## Consequences

- The README's "Limits today" says Your miners shows BNB Chain miners and RIG vouchers only.
- If FabX's market is read later, copy alerts and a FabX holder index would come back together as one proposal.
