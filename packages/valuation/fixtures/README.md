# Valuation fixtures

## Market sales: `bnb-sales-132025299-134713299.json`

Every `Sold` event on TapeOut's circuit market (`0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f`) in blocks 132,025,299 to 134,713,299 (7 to 20 November 2026): 425 sales. Recorded on 20 November 2026 from the archive node with a one-off read-only script; the endpoint and its key are not in the file.

| Field | From |
| --- | --- |
| `toBlock`, `toTime` | the last block and its timestamp: the block the comparables are read at |
| `block`, `time`, `tx`, `logIndex` | the `Sold` log and its block's timestamp |
| `processor`, `tokenId`, `priceWei` | the event: `priceWei` = `sellerProceeds + fee`, what the buyer paid |
| `status`, `taskId`, `verifWeight`, `unverWeight` | `getMiner` on the PodMining contract at the block before the sale: status 1 is mining; task 0 is the unverified pool |

The Sell comparables tests (`src/comparables.test.ts`) check the rule against it, with expected ranges worked out separately in Python with exact fractions. The ADR's evidence (`docs/decisions/2026-11-20-sell-comparables.md`) comes from the same sales: 145 by miners that were mining, 140 verified and 5 unverified.
