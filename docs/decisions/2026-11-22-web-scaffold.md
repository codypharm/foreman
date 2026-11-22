# The web app's routing, styling and fetching

- **Date:** 22 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Builds on:** `2026-11-18-frontend.md` (Vite, React, wagmi and viem; "the routing, styling and translation libraries are chosen at scaffold time, each with what it costs")

## Context

`apps/web` is next. It has four chosen mocks: the live listings (`docs/mocks/2026-11-21-live-listings.html`, with rows from `2026-11-22-listings-row-range.html`), the result page (`2026-11-21-result-page.html`, with `2026-11-22-voucher-held.html`) and your miners (`2026-11-21-copy-alert.html`). The mocks are plain CSS with colour tokens on `:root` and a dark theme. Every page reads the Foreman API (`GET /listings`, `GET /circuit/:processor/:tokenId`, `GET /wallet/:address/miners`), and every response goes through the data contract's parser.

Translation isn't needed: Chinese was taken out of scope on 20 November (`docs/PRODUCT.md`, "Out").

## Options and decisions

Chosen by William in a grilling on 22 Nov 2026, each the recommended option.

| Job | Options | Chosen |
| --- | --- | --- |
| Routing | **wouter**; React Router; a hand-written hash router | **wouter** |
| Styling | **CSS Modules**; Tailwind; plain global CSS | **CSS Modules** |
| Fetching | **TanStack Query**; plain `fetch` in hooks | **TanStack Query** |

- **wouter:** about 2 KB gzipped. Its hash-location mode is built in, so the app can serve every page from `index.html` whether or not DeWEB sends every path there. The app starts on hash routes (`#/`, `#/circuit/<processor>/<id>`, `#/wallet`) until DeWEB's path handling is checked.
- **CSS Modules:** built into Vite, no dependency. One global stylesheet holds the mocks' tokens and both themes; each component has its own module, so the mocks' CSS moves across almost as is.
- **TanStack Query:** about 13 KB gzipped. Caching, retries, loading and error states, and refetching. wagmi depends on it anyway, so it isn't extra once the wallet page is built.

## Dependencies added

Each pinned to its newest release at least two weeks old on 22 Nov 2026.

| Package | Version | Replaces | Costs |
| --- | --- | --- | --- |
| `vite` | 8.3.6 (dev) | Nothing: the build tool from `2026-11-18-frontend.md` | Dev only; the output is static files |
| `react`, `react-dom` | 19.3.1 | Nothing: decided on 18 Nov | About 60 KB gzipped in the bundle |
| `@types/react`, `@types/react-dom` | 19.3.0 (dev) | Nothing | Types only |
| `wouter` | 3.13.0 | React Router | About 2 KB gzipped; brings `regexparam` and `use-sync-external-store` |
| `@tanstack/react-query` | 5.107.1 | Hand-written fetch state | About 13 KB gzipped |

`@vitejs/plugin-react` is left out: Vite 8 compiles JSX itself, and the plugin's only gain here would be keeping component state across edits in development.

## What follows

- wagmi and viem are added with the wallet page, each with its cost.
- The API's address is a build setting (`VITE_API_URL`), public by nature; the bundle holds no secret.
- Build order: the live listings page, then the result page, then your miners.
