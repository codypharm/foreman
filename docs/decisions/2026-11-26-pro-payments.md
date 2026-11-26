# Payments for Foreman Pro, on the X Layer testnet

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling of seven questions, each with a recommended answer and its alternatives
- **Extends:** `2026-11-26-telegram-alerts-for-pro.md` (decision 2: one followed address free, 20 with Pro) and `2026-11-26-revenue-and-reach.md`. Neither is edited

## Context

Foreman Pro lets one Telegram chat follow up to 20 addresses instead of 1. The bot already asks "how many addresses may this chat follow?" before every `/follow` (`limitFor` in `apps/api/src/alerts/bot.ts`), and until now the answer was always 1, because nothing could be paid. Payments are first on the cut list: they are cut unless they work end to end on the evening of 2 December 2026. There is no money for mainnet (26 Nov 2026), so everything here is on the X Layer testnet, chain 1952.

## Decisions

### 1. Paid in testnet OKB on X Layer

Not by card. A card processor takes about 2.9% + 30¢ a payment, may not be open in every country, needs an account opened by William, and adds nothing to Foreman's use of X Layer, which the judges score. On chain, the payer pays only gas and anyone with OKX Wallet can try it with OKB from the testnet faucet. Card payments can be named as later in the README.

### 2. 0.01 test OKB buys 30 days

Paying again adds 30 days to whatever is left (from the later of now and the current end). The page says it's a test amount and that the real price isn't set, which keeps the 26 Nov rule against naming prices before there are customers.

### 3. A small ForemanPro contract

`contracts/src/ForemanPro.sol`, Foundry, not upgradeable, deployed by William on the testnet with his own keystore, as `ForemanResults` was. Proposed shape:

- `pay(bytes32 code)`, payable, refuses any amount other than exactly 0.01 OKB (a constant in the contract);
- emits `Paid(bytes32 indexed code, address indexed payer, uint256 amount)`;
- `withdraw()` sends the balance to the owner, William's owner wallet; nobody else can move it.

The 30 days are Foreman's rule, counted from each `Paid` event, not stored in the contract. Every payment can be re-checked from the events. The address goes into "On-chain facts" once it's deployed and confirmed.

### 4. The bot gives a pay link

`/pro` in the bot replies with a link to `#/pro/<code>`, where the code is 16 random bytes made for that chat and kept with it (the same code every time, so renewals need no new link). The chat id never goes on chain. Anyone may pay for any code, so a friend can gift Pro.

### 5. The page reports the payment; the worker backs it up

When the payment lands, the page sends its transaction hash to the API. The API reads the receipt from the X Layer testnet, checks the `Paid` event came from the confirmed ForemanPro address with exactly 0.01 OKB and a known code, records it once per transaction, extends that chat's Pro and has the bot say so. The 5-minute worker also reads `Paid` events, so a payment whose page closed early is still counted. A transaction counted twice is counted once.

### 6. When Pro runs out, follows are kept and all but one pause

Every follow is kept. Alerts continue for the first address the chat followed; the rest pause, and copies listed while paused are never sent later. New follows beyond one are refused. The bot says so 3 days before and on the day, with the pay link. Paying again resumes every follow.

### 7. Shown in the bot's /pro and one Pro page

- `/pro` shows the chat's status ("Pro until 26 Dec 2026", or "1 of 1 address followed") and the pay link.
- One web page, `#/pro`. With a code, it pays for that chat. Without one, it says what Pro gives and links to the bot. No nav item.
- The Telegram line on Your miners adds that Pro follows up to 20.
- The page is mocked in 2–3 directions and William chooses before it's built.

### 8. The demo says it and doesn't show it

The video's business part says, in one line over the bot, that Foreman Pro is paid on X Layer. It shows no payment. If payments are cut, the line goes back to "next".

## Build order

Each step works before the next.

1. The contract and its Foundry tests (exact amount, event, owner-only withdraw); William deploys it on the testnet.
2. Storage in `packages/index`: each chat's code, payments by transaction, Pro's end per chat (test first: renewals add, a transaction counts once, a lapsed chat's limit is 1).
3. The bot: `/pro`, `limitFor` reading Pro's end, the pause rule in the send job, the two reminders.
4. The API: the payment report, test first on saved receipts (wrong contract, wrong amount, unknown code, a repeat).
5. The worker's backup read of `Paid` events.
6. The `#/pro` page's mocks, William's choice, then the page.

## Consequences

- `ForemanPro` joins `ForemanResults` in `contracts/`. It needs no publisher wallet: only payers sign, and only William's owner wallet can withdraw.
- `GET /health` doesn't change; a failed backup read is a worker stage failure like any other.
- The README and demo still say "next" for Pro until it works end to end; then the README says it's live on testnet.
