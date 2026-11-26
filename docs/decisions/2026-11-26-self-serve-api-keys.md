# Self-serve API keys, made with a wallet signature

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, after trying the keyed API with a key made by hand
- **Supersedes:** decision 5 of `2026-11-26-api-keys.md` ("William issues keys by hand") in part: keys are made on the site; William's commands stay. That record isn't edited; where this one differs, it decides

## Context

`2026-11-26-api-keys.md` built `POST /v1/results` with keys William makes by hand. On 26 Nov 2026 William made the first key on Railway and the call answered from the live API. Then he asked how someone who wants a key would get one. The README said "ask for a key" but named nowhere to ask, and the website didn't show the API at all. Every partner, and every judge trying the product, would have to reach William first.

## Decision

1. **A "For markets" page in the web app** says what the API answers, with a real example request and response, the limits, and a way to make a key. It is mocked first, with 2–3 directions, and built to the one William chooses.
2. **A key is made with a wallet signature.**
   - The visitor connects a wallet, as on Your miners: injected wallets, OKX Wallet first.
   - They sign a plain message naming the wallet and the time, for example "Make a Foreman API key for 0x… at 2026-11-27T12:00:00Z". It is free: no transaction and no gas.
   - The API checks the signature and the time, and refuses a message more than 10 minutes old.
   - The new key is shown once, on the page, and never again. Only its hash is stored, as before.
3. **One live key per wallet.** Making a new key revokes the wallet's old one, so a lost or leaked key is replaced in one step.
4. **Keys don't expire.** A key works until it is revoked: by a new key from its wallet, or by William. The daily usage records show which keys are idle.
5. **William's commands stay.**
   - `api-key create "<holder>"` still makes a key with no wallet, for a partner who asks.
   - `api-key list` shows each key's wallet, if it has one.
   - `api-key revoke <id>` revokes any key.
6. **The limits are unchanged:** 60 calls a minute per key, and usage counted per key per day.
   - A visitor could make keys from many wallets to get past the per-key limit. For a free API before billing, that is accepted.
   - The key endpoint is called from the browser, so it allows CORS. `/v1` still doesn't.

## Alternatives considered

- **Keys by hand only, with a contact in the README:** no new page, but every partner and judge has to reach William first.
- **Keys that expire after a set time:** safer against an unnoticed leak, but a market's checks stop on the day the key expires.
- **Keys that expire when unused:** cleans up idle keys, but adds code; the usage records already let William find them.
- **Email sign-up:** needs mail sending and an account model; the site already connects wallets.

## What follows

- **Tests** (CLAUDE.md, "Bad input"):
  - A valid signature makes a key that answers `/v1/results`.
  - A second key from the same wallet revokes the first.
  - A signature from another wallet, a changed message, or a message over 10 minutes old is refused, and no key is made.
- **A migration** adds the wallet to `api_keys`, with at most one live key per wallet.
- **The wallet promise changes.** The connect menu says "It never asks you to sign or send anything" (`2026-11-23-wallet-connect.md`), and that stops being true. The new line says Foreman never asks a wallet to send anything, and asks for a signature only when the visitor makes an API key on the "For markets" page; its words come with the chosen mock. Your miners and the Telegram button still never ask for one.
- **The README** points to the page instead of "ask for a key".
- **Smart-contract wallets** (signatures checked by contract, EIP-1271) aren't supported before the freeze; OKX Wallet's accounts sign as plain addresses.
