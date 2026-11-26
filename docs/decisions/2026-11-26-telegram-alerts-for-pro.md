# Telegram copy alerts, built ready for Foreman Pro

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling of three questions, each with a recommended answer and its alternatives
- **Extends:** `2026-11-23-copy-alert-notifications.md` and `2026-11-26-revenue-and-reach.md`. Neither is edited; where this record differs, it decides

## Context

On 26 November 2026 William chose to build all three paid paths from `2026-11-26-revenue-and-reach.md` before the freeze, in this order: Telegram alerts (Foreman Pro's core), API keys for markets and lenders, then payments for Pro. Payments are cut first if they aren't working end to end by the evening of 2 December 2026, and API keys second.

`2026-11-23-copy-alert-notifications.md` designed the alerts with following free for anyone. Since then, Telegram alerts became part of the paid Pro, so the free line had to be drawn before the bot is built.

## Decisions

### 1. Telegram only, for the submission

The bot is built as the 23 Nov record describes: its commands, the alert rule (decision 3), the message (decision 8), stopping and what's kept (decision 10), and the secrets (decision 6). Browser notifications, their push routes and the VAPID keys are not built before the freeze.

### 2. One followed address free; more is Pro

- Any Telegram chat can follow **one** address free.
- A chat with Pro can follow up to **20**. Both numbers are constants in one place.
- Until payments are built, no chat has Pro, so every chat has one address. The bot says so in one line when a second `/follow` is refused, and names Pro without a price.
- This narrows the 23 Nov decision 4, "anyone can follow any address": anyone still can, one at a time.

### 3. Links go to existing result pages

A message links to the followed miner's result page and the newest copy's result page. `#/wallet/<address>` (the 23 Nov decision 9) is not built before the freeze.

### 4. A button on Your miners, mocked first

Your miners gets one button that opens the bot with the connected wallet's address filled in. Its placement is mocked in 2–3 directions and William chooses before it's built.

## Consequences

- The build order of the 23 Nov record applies, minus the push routes and the wallet route: the follows tables in `packages/index`; the send job, test first; the bot; the button's mock, then the button.
- The cut list gains API keys and payments, ahead of copy alert notifications: payments first, then API keys, then notifications.
