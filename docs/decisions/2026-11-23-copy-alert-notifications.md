# Copy alerts by Telegram and browser notification

- **Date:** 23 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling on 23 Nov 2026 (each the recommended option)
- **Builds on:** `2026-11-21-api-endpoints.md` decision 6 (the alert rule), `2026-11-23-wallet-connect.md` (Your miners, one alert per design), `2026-11-18-api-and-jobs.md` (Hono, Postgres, pg-boss)
- **Clarifies:** `2026-11-20-scope-and-team.md`, which cut "the Telegram bot"

## Context

Copy alerts show on Your miners only while a wallet is connected. William wants owners told even when they aren't on Foreman. Two channels were chosen: a Telegram bot (A) and browser notifications (B). Email was not.

An alert is built from public chain data: anyone can see which copies of an address's miners are listed. So following an address reveals nothing new.

## Decisions

1. **Order: after read-back and hosting.**
   - The sequence is: reading a published result back from X Layer, then hosting (still open), then Telegram, then browser notifications.
   - Notifications need Foreman hosted and the follow running on a schedule.
   - **They go first on the cut list,** ahead of OCCC status. Both channels are stretch, and the demo already shows alerts on Your miners.

2. **The bot sends alerts only.**
   - Its commands are `/follow 0x…`, `/unfollow 0x…`, `/list` and `/stop`.
   - It answers no lookups, verdicts or values in chat.
   - This is PRODUCT.md's stretch item "alerts by email or Telegram". It is not the autopilot bot cut on 20 Nov, which was a full second client of the API.

3. **What triggers a message.**
   - The alert rule is unchanged: open listings of later identical circuits, at or above the size floor, not listed by the wallet.
   - A listing is sent only if its `Listed` block is after both the block the address was followed at and the block the miner came to the wallet. Copies already listed stay on the page and are never sent.
   - At most one message per design per follow run.
   - Each listing is sent to a follower at most once (a record of what was sent).
   - A withdrawn listing sends nothing.

4. **Anyone can follow any address, with no signature.**
   - From Your miners, one tap follows the connected wallet: it opens the bot with the address filled in, or turns on browser notifications.
   - In the bot, `/follow 0x…` follows any address.
   - Foreman still never asks a wallet to sign.
   - Because a follower may not own the address, messages name it instead of saying "your".

5. **Shape.**
   - The bot is a pg-boss worker that long-polls Telegram, so it needs no public webhook and can run locally.
   - Browser notifications add the API's first write routes, `POST /follow/push` and `DELETE /follow/push`. They take the address and the browser's subscription, check both and are rate-limited. CORS widens from GET only to these two.
   - A job after each follow run sends both channels.
   - Follows and the record of what was sent live in Postgres, in `packages/index`.

6. **Secrets.**
   - William creates the bot with BotFather and generates the VAPID key pair himself.
   - `TELEGRAM_BOT_TOKEN` and `VAPID_PRIVATE_KEY` live only in the host's secret settings and William's local `.env`. `.env.example` names them, empty.
   - The VAPID public key is public by design and goes in the web build (`VITE_VAPID_PUBLIC_KEY`).
   - The agent never sees, prints or logs either secret. A leaked bot token is revoked in BotFather.

7. **Where browser notifications work.**
   - Your miners offers "Turn on browser notifications" only where the browser supports them. Elsewhere it shows only the Telegram button, with one line saying why.
   - No installable-app work for iPhone.
   - Whether OKX Wallet's in-app browser and DeWEB support them is checked at build time and recorded.

8. **What a message says.** The same words in both channels, facts only:

   > 2 new copies of #10278, held by 0x077e…2ea5, were listed on TapeOut's market. Newest: #13931 at 2.36 BNB, listed 20 Nov. Identical netlist, designed later.

   - It carries a link to that address's miners and one to the newest copy's result page.
   - It never includes a value, advice, or words like "fake" or "stolen".

9. **The link lands on `#/wallet/<address>`.**
   - It shows any address's miners and copy alerts, read-only: the same page as Your miners, headed "Miners held by 0x077e…2ea5". `#/wallet` stays the connected wallet.
   - It's a variant of the chosen mock, so it is mocked and chosen before it's built.
   - This settles the route left open in `2026-11-23-wallet-connect.md`.

10. **Stopping, and what's kept.**
    - Telegram: `/unfollow` or `/stop`. Blocking the bot deletes its follows.
    - Browser: a "Turn off" button. A subscription the browser reports gone is deleted.
    - Foreman keeps only the address, the Telegram chat id or browser endpoint, the block it was followed at, and which listings were sent. No names, no emails, no expiry.

## What follows

- **Build order:** after read-back and hosting.
  1. The follows tables in `packages/index`.
  2. The send job, with tests for decision 3: nothing already listed is sent, each listing is sent once per follower, one message per design per run.
  3. The bot.
  4. The `#/wallet/<address>` mock, then the route.
  5. The push routes and the button.
- `CLAUDE.md` and `PRODUCT.md` put notifications first on the cut list.
