# The API's endpoints

- **Date:** 21 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-18-api-and-jobs.md` (Hono, Postgres, pg-boss), `2026-11-20-circuit-index.md`, `2026-11-20-complete-result-or-none.md`, `2026-11-20-payback-and-bem-price.md`
- **For:** the chosen mocks of 21 Nov 2026: `docs/mocks/2026-11-21-live-listings.html`, `2026-11-21-result-page.html`, `2026-11-21-copy-alert.html`

## Context

Three pages have chosen mocks. William's order is mocks, then the API, then the pages. `docs/PRODUCT.md` also promises markets and lenders (TapeOut's market, OwlGate, TapePool) "an API" alongside the results on X Layer.

Three facts shape it:

- **The listings page needs a verdict for every open listing at once** (6,176 on 21 Nov). Today's result builder (`apps/api/src/result.ts`) reads each circuit's can-mine facts from the archive node, which is far too slow per request.
- **Market listings already store their miner's weight and state with the block they were read at** (`market_listings`). The `miners` table has no weight.
- **A circuit NFT stays in its owner's wallet while it mines.** The market has no escrow, and `read-miner.ts` reads the owner with the processor's `ownerOf`.

## Decision

Settled by a grilling on 21 Nov 2026, one question at a time.

1. **Scope: three page endpoints, public and read-only.** The web app and partners use the same API: public JSON, no keys, documented in the README. Nothing else is added until a page needs it. Partners can also read published results straight from X Layer.
2. **Originality is stored by a job.** After each 5-minute index follow, a job rebuilds the results that changed and stores each with its index block. The API only reads these rows. The publish job reads the same table, so a page and the chain can't disagree. A circuit with no stored result is "Can't check".
3. **Values are computed on request.** The estimated value, payback and options are computed when a page asks, from:
   - stored data: network history, market sales, and each listing's stored weight;
   - a few live reads, each stating its block and cached for a minute: the miner's weight, the BEM/WBNB pool's 30-minute average, and a TapePool quote for a RIG voucher.

   A listing row's "≈ X BEM / 30 days" uses the weight stored with the listing, so a listings page makes no live reads.
4. **The Check box accepts four kinds of input**, each resolved to one circuit (processor and circuit id):
   - a market listing number;
   - a miner key (0x and 64 hex digits);
   - a circuit, as processor and id;
   - a RIG voucher number, resolved through the rig vault.

   The page lives at `/circuit/<processor>/<id>`. Anything else is "Not recognised", with a list of what is accepted. Market links are left out until their formats are confirmed.
5. **A wallet's miners come from followed transfers.** Foreman scans the ERC-721 `Transfer` events of the two eligible processors once from the archive node. The 5-minute job then follows them, storing each circuit's current owner with its block, so a wallet lookup is one query. RIG vouchers the wallet holds on X Layer are read live and mapped to their miners.
6. **Copy alerts: one per owned miner.** An alert counts the open market listings of later identical circuits at or above the size floor, newest first:
   - "3 copies listed", the newest few with price and listing date, and the rest behind "Show all";
   - listings by the wallet itself are left out;
   - "Just listed" marks listings from the last 7 days.

   Alerts show when the wallet connects. There's no push and no accounts.
7. **The response shapes go into the data contract first.** The three shapes are written into `docs/data-contract.md` as provisional:
   - a listing row;
   - the circuit page;
   - a wallet's miners with their alerts.

   They're built from the existing types (`Originality`, sourced values, `Offer`, `Payback`), with amounts as decimal strings. William approves the diff before any endpoint is built. Parsers and tests go in `packages/contract`.

## What follows

- **Build order:**
  1. the contract diff;
  2. the results table and its job;
  3. the circuit page endpoint;
  4. the listings endpoint;
  5. the owner follow and the wallet endpoint.

  Each works end to end before the next.
- **One 5-minute job runs in order:** the index follow, the market follow, the owner follow, then rebuilding the changed results. A failed step is retried and reported, never turned into a missing verdict or a zero.
- **Tests** follow CLAUDE.md "Tests that are not optional": the stored result decodes to the same verdict and evidence, a circuit outside the index is "Can't check", values carry their inputs and blocks, and bad input gives a clear error. Copy alerts get tests for the size floor, the wallet's own listings and earliest-design ordering.
- **Hosting is still open.** The API runs locally until it's chosen.
- **Not checked yet:** how a RIG voucher number maps to its miner key on chain. It's read from the confirmed RIG and rig vault contracts before the resolver is built.
