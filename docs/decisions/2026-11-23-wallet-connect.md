# Connecting a wallet, and showing many copy alerts

- **Date:** 23 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-18-frontend.md` (wagmi and viem, OKX Wallet first; whether OKX's Connect SDK is needed was left to this build), `2026-11-21-api-endpoints.md` decision 6 (one alert per owned miner), `2026-11-22-wallet-miners.md` (`GET /wallet/:address/miners`)

## Context

"Your miners" is the last page in the build order. It needs the connected wallet's address, and nothing else from the wallet: Foreman never signs or sends anything.

A real wallet, `0x077e…2ea5`, holds 64 miners. 21 of them have a copy alert, but those 21 share only 4 designs. Sixteen are one design, so sixteen per-miner alerts would list the same 7 listings. The chosen copy alert mock (`docs/mocks/2026-11-21-copy-alert.html`) showed one alert with one copy and left this case open.

## Decisions

Chosen by William on 23 Nov 2026.

1. **wagmi, injected wallets only.** Wallets are found through EIP-6963, which OKX Wallet's extension and in-app browser support. A plain `window.ethereum` wallet that doesn't announce itself is also offered. Nothing else is used: no WalletConnect, no OKX Connect SDK, no wallet modal library.
   - **One wallet found:** connects at once.
   - **Several found:** a short list, OKX Wallet first.
   - **None found:** the words "Open Foreman in OKX Wallet's browser, or install a wallet extension and reload."
   - **Connected:** a green dot and the short address, with a menu for Your miners and Disconnect.
   - **The limit:** a phone browser with no injected wallet (Safari or Chrome on a phone, outside OKX Wallet's browser) can't connect. Adding WalletConnect or OKX's Connect SDK later would cover it, and needs a project id and a relay.

2. **One copy alert per design** (option A of three in `docs/mocks/2026-11-23-copy-alerts-by-design.html`). The API is unchanged: it still sends one alert per miner. The page groups them:
   - **One card per design.** The wallet's miners with the same netlist hash share a card.
   - **The copies.** Every listing in those miners' alerts, each once, newest first. The first 3 are shown, then "Show all".
   - **Order.** Designs with a copy listed in the last 7 days come first, as full cards. The others follow as short cards.
   - **The wallet's own miners.** Each card says whether they are themselves identical to an earlier circuit (3 of the 4 designs above are).
   - **The rule line.** It names the wallet's miner with the earliest design time, using the contract's own `designedEarlier`.

3. **"Just listed" and a miner row's "7 copies listed" are text, not badges** (William, 23 Nov 2026). Lemon text marks a copy listed this week; a design whose copies are older shows grey text. In light mode the lemon `#C2F24B` reads at 1.2:1 on the card, so the text uses a deep lemon `#567300` there (5.0:1). Dark mode keeps `#C2F24B` (14:1). Both are kept in the token `--new`.

## Costs

- **`wagmi` 3.7.11 and `viem` 2.57.16 in `apps/web`.** wagmi was chosen on 18 Nov. Pinned exactly; 3.7.11 is the newest release at least two weeks old (3 Nov 2026), and viem matches the rest of the workspace. The app's script grows from 99.9 KB to 124.5 KB gzipped (about 25 KB).
- **`vitest` in `apps/web`'s dev dependencies,** already used by the packages. It tests the alert grouping against a real wallet response (`src/fixtures/wallet-077e-135141389.json`), because a wrong count there would show a buyer the wrong number of copies with nothing to say it was wrong.
- **The aside drops "Checked: every 5 minutes".** That isn't true until Foreman is hosted and the follow runs on a schedule. It shows the blocks the owners and the market were read to instead.

## For checking without a wallet

`VITE_DEV_WALLET=0x…` adds wagmi's mock connector for that address, in `vite dev` only. The production build doesn't contain it (checked on the build). The `foreman-web-dev-wallet` entry in `.claude/launch.json` serves it on port 5174. The mock connector doesn't survive a page reload; real wallets reconnect.

## Not decided

- **`#/wallet/:address`.** A route showing any wallet's miners without connecting would help a demo and a buyer looking at a seller. It is a flow change, so it isn't built until William chooses it.
