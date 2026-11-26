# Revenue model and how Foreman reaches its users

- **Date:** 26 November 2026
- **Status:** Accepted
- **Decided by:** William, in a grilling of two questions, each with a recommended answer and its alternatives
- **Extends:** `2026-11-20-scope-and-team.md` and `docs/PRODUCT.md`, "Users". Neither ADR is edited

## Context

The hackathon's rules ask every project to explain its target users and how to reach them, its proposed revenue model, and why users would pay and keep using it. The demo video must cover the target users and the business model. Until today Foreman had one line on this: "an API for them, and premium alerts, are the paths to revenue".

## Decisions

### 1. Free to check, pay to be watched, pay to integrate

| Who | Free | Paid |
| --- | --- | --- |
| **Buyers** | Every verdict, estimated value, payback and published result | Nothing. Free checks bring users in |
| **Owners** | Your miners and copy alerts in the app while a wallet is connected | **Foreman Pro:** copy alerts sent by Telegram and browser notification, many wallets watched at once, value history |
| **Markets, wallets, lenders** | Reading published results on X Layer | **The API:** a check before a circuit is listed, bulk results, estimated values and payback, and a webhook when a copy is listed |

The published results on X Layer stay free to read. They are the public record anyone can re-check, and charging for them would undercut the trust the paid parts depend on.

**Why they would pay and keep paying:**

- **An owner** pays to hear about a copy of their miner without checking the site. A copy can be listed at any time, so the need lasts as long as they hold miners.
- **A market or lender** pays because listing or lending against a copy costs it its users' trust, and the API is cheaper than building and following an index of every circuit on two chains itself.

**Live today versus next.** The free column is built and live. Foreman Pro and the API are not built: Telegram and browser alerts are on the cut list (`2026-11-23-copy-alert-notifications.md`), and there are no API keys or billing. The README, the submission form and the demo video say "next" for both, never show them as live, and name no prices.

*Rejected:*
- **A verification fee per circuit**, paid by sellers or markets for a "checked" badge. The seller would be paying the checker, a conflict for a product whose worth is being neutral.
- **Prices named now.** They would be guesses with no customers behind them.

### 2. Reach: community, shared links, partners

Cheapest first:

1. **Facts where TapeOut's users already are**: TapeOut's community channels and X. Each post states a fact the index shows, with a link to check one's own miner, for example "4,982 of FabX's 7,145 miners are identical to an earlier circuit". Facts, never accusations, as the trust rules require.
2. **Every result page is a link.** A buyer pastes it into a trade chat before a deal, and each share reaches a new user.
3. **Partners.** Offer the free published results, then the API, to the markets and tools buyers trade through: OwlGate, TapePool, TapeOut's circuit market and FabX. One integration reaches all their users.

*Rejected:*
- **Partners first:** larger wins but slower, since each depends on another team's priorities.
- **Community only:** fast and free, but it caps the API revenue, which depends on partners.

## Consequences

- `docs/PRODUCT.md`, Users: the "Pays?" column follows decision 1.
- `README.md`, "Who it's for": the business model and the reach channels, both marked as live or next.
- `docs/demo-script.md`: the video's business part follows this record.
