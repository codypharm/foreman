# What the Check box accepts and how each input finds its circuit

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-21-api-endpoints.md`, decision 4 (the Check box accepts a market listing number, a miner key, a processor and id, or a RIG voucher number; `GET /check?q=…` returns `{ processor, tokenId }` or `ApiError`)

## Context

The result page is built, and its top bar has a Check box that isn't wired yet. The endpoint and its response were approved on 21 November. Two behaviours were left open:

- listing numbers, RIG voucher numbers and circuit ids are all plain numbers;
- a listing number can name a listing that's no longer open.

Foreman's market index stores the circuit of every open listing, and of every sold one through its `Sold` event. It doesn't store the circuit of a withdrawn listing. The market's source isn't verified, so its storage can't be read back either.

## Decisions

Chosen by William in a grilling on 22 Nov 2026, each the recommended option.

1. **A bare number is a market listing number.** A buyer most often has a listing. The other inputs need their own words:

   | Input | Accepted forms (any case, spaces optional) | Found through |
   | --- | --- | --- |
   | Listing number | `28074`, `#28074`, `listing 28074` | The stored market index |
   | RIG voucher number | `RIG 19`, `voucher 19`, `RIG voucher #19` | RIG's `rigs(id)` on X Layer, read live |
   | Miner key | `0x` and 64 hexadecimal digits | The stored miners |
   | Circuit | `0x…` processor, then the id after a space, `/` or `#` | Itself; the result page reports a circuit outside the index |

   Anything else is "Not recognised", with the list of accepted forms.

2. **Sold listings resolve; withdrawn ones are refused.** An open or sold listing opens its circuit's page. A withdrawn listing says so in plain words, without a guess: "Listing N was withdrawn, so Foreman doesn't know its circuit. Paste the circuit or its miner key instead." No schema change.

## What each failure says

All of these are the contract's `ApiError`. None is a crash, a guess or a silent empty.

- **No such listing:** `unknown-circuit`, "No listing N on TapeOut's circuit market up to BNB block B".
- **Withdrawn listing:** `unknown-circuit`, with the words above.
- **Voucher not live:** `unknown-circuit`. RIG returns an empty record for a voucher that was redeemed and for one that was never minted (22 Nov 2026, X Layer block 76,612,142: #3 and #20 to #25 empty, and `ownerOf` reverts for both). So the words are "No live RIG voucher #N on X Layer: it was never minted or has been redeemed."
- **Miner key not in the index:** `unknown-circuit`, "No miner with that key in the index up to BNB block B".
- **A read that failed:** `read-failed`, with its detail.

## What follows

- `packages/contract` gets the answer's parser and serialiser.
- `packages/chain-xlayer` reads one voucher's circuit.
- `packages/index` finds a listing's or a miner key's circuit.
- `apps/api` serves `GET /check`, and the web app's Check box opens the result page it names.
- Market links stay out until their formats are confirmed, as on 21 November.
