# A paid API tier, paid from the business's wallet on the X Layer testnet

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William: option B of three (A: keep the API free and say paid plans come later; C: Pro without Telegram), then a grilling of six questions, each with a recommended answer and its alternatives
- **Extends:** `2026-11-26-api-keys.md` (decision 6: "no tiers, no prices"), `2026-11-26-self-serve-api-keys.md` and `2026-11-26-pro-payments.md`. None is edited

## Context

Foreman Pro is paid per Telegram chat, which suits miner owners. Markets, wallets and lenders come in through the API page instead, where a key is free, made with a wallet signature, and allows 60 calls a minute of up to 100 circuits each. They have nothing to pay for, and they won't go through Telegram. Pro's payments worked end to end on 26 Nov 2026 (transaction `0x070cbb2b…1f950154`), so the same contract and checks can carry a business's payment from the API page.

## Decisions

### 1. Paying gives 10× the calls

A paid wallet's key may make **600 calls a minute** instead of 60. Everything else is unchanged: up to 100 circuits a call, the same answers, the same daily usage records. The free tier stays exactly as it is.

### 2. The payment belongs to the wallet, not the key

The higher limit follows the wallet that made the key. A new key from the same wallet keeps it, so replacing a lost or leaked key never loses what was paid. Keys William makes by hand (`api-key create`) have no wallet and stay at 60.

### 3. 0.01 test OKB for 30 days, through ForemanPro

The same contract and amount as Pro: no new contract and no deploy. Paying again adds 30 days from the later of the payment's time and the current end. The page says it's a test amount and the real price isn't set.

### 4. The code is the wallet's address, tagged

A payment for a wallet's API calls `pay(code)` with `code` = the wallet's 20-byte address followed by the 12 ASCII bytes `foreman-api:`. Its last bytes aren't zero, so it is never a chat's code (`2026-11-26-pro-payments.md`, decision 4). Anyone can read on chain which wallet's API was paid, and Foreman needs nothing stored to know it. The API's payment check and the worker's backup read count these payments as they count Pro's: once per transaction and log.

### 5. When it ends, the key goes back to 60

The key keeps working. Two places say so: the API page ("600 calls a minute until 26 Dec 2026", or that it ended), and a 429 above 60 for a wallet whose paid time ended, which says so and where to pay. No reminders: businesses have no Telegram chat.

### 6. Paid on the API page, by a wallet that has a key

The API page's key band gains a pay control for the connected wallet once it has a key. It is mocked first, in 2–3 directions, and William chooses. A payment for a wallet without a key still counts, since the contract can't refuse it, and applies once that wallet makes one.

### 7. The key status carries the paid end

`ApiKeyStatus` (`GET /keys/:wallet`) gains `paidUntil`: when the wallet's higher limit ends, or null when it never paid or it has ended. This widens the data contract with William's agreement. The key itself is still never returned.

### 8. The demo says it in one line

Over the existing API shot: businesses pay on X Layer for 10× the calls. No payment is shown, as for Pro.

## Build order

1. Storage and the code: a wallet's code, and its paid end worked out from its payments (test first: renewals add, a chat's code is never a wallet's).
2. The limit: 600 a minute for a paid wallet's key, 60 otherwise, and the 429 that says the paid time ended.
3. `paidUntil` in `ApiKeyStatus`, in the contract's parsers and the README.
4. The API page's pay band: mocks, William's choice, then the build.

## Cut list

The paid API tier goes first on the cut list, before payments for Foreman Pro: it is cut unless it works end to end on the evening of 2 December 2026.

## Alternatives considered

- **A. Keep the API free for the hackathon** and say paid plans come later. No build. Not chosen: William wants a business to be able to pay before submission.
- **C. Pro without Telegram,** with alerts by email or in the browser for a wallet. Not chosen: a new alert channel doesn't fit before the 5 Dec freeze.
- **Bigger calls (1,000 circuits) or a daily cap on free keys** instead of more calls a minute. Not chosen: bigger calls are slow, as circuits without a stored result are built in the call, and a cap takes something away from today's free keys.
- **The payment belongs to the key.** Not chosen: replacing a leaked key would lose what was paid.
- **A new contract with a higher amount.** Not chosen: it needs a deploy and Sourcify for a test amount that isn't a real price.
- **A random code per wallet, like a chat's.** Not chosen: the wallet already shows on chain as the payer, and a stored code adds a lookup for nothing.
- **A response header on every `/v1` answer saying when the paid time ends.** Not chosen: it changes the API's answers for a reminder few would read.
- **A separate `GET /keys/:wallet/plan`.** Not chosen: one more endpoint and request where the page already reads the key status.
