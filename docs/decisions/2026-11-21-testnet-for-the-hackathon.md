# Testnet for the hackathon

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-results-contract.md` (testnet first), `2026-11-21-publish-job.md`
- **Changes:** the 27–29 Nov row of `docs/PRODUCT.md`'s build order ("testnet first, then mainnet"); mainnet is no longer planned for the submission

## Context

ForemanResults is deployed on X Layer testnet (chain 1952) at `0xe1b2343d3da66afec740c0fcaf40a701e2d513e8`, and its source is verified on Sourcify (exact match). The first publish put all 26,702 results there on 21 Nov 2026, and they were checked against the plan, the local table and contract storage. Mainnet (chain 196) has no contract yet.

The hackathon's hard requirement is to use TapeOut circuits, contracts or X Layer on-chain data, or run on DeWEB, and to give the addresses. As read on 21 Nov 2026, it doesn't require mainnet. X Layer mainnet was already last on the cut list, with "publish on testnet for the demo" as the fallback.

## Decision

**Foreman stays on X Layer testnet for this hackathon,** unless the hackathon requires mainnet. The demo, the README and the submission give the testnet contract's address and present it as testnet. A published result is never called a mainnet result.

## What follows

- Mainnet stays undeployed: `RESULTS_CONTRACTS[196]` stays `null`, so the publish job keeps refusing chain 196.
- The web app reads published results from the testnet contract.
- Foreman still reads its data from BNB Chain and X Layer mainnet: the miners, the market, RIG vouchers and TapePool. Only Foreman's own published results are on the testnet.
- **Revisit** if the rules, the organisers or the judges require mainnet. Deploying then is William's job, with the same deploy script and a new owner/publisher check, followed by a new ADR. After the hackathon, a mainnet deploy is expected before launch.
