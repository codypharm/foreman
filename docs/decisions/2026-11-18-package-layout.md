# Package manager and layout: pnpm workspaces

- **Date:** 18 November 2026
- **Status:** Accepted for William's folders. Furqaan lays out his own
- **Decided by:** William
- **Depends on:** `2026-11-18-language.md` (TypeScript everywhere)

## Context

With TypeScript everywhere, the web app, the API and the valuation engine all import the data contract's types. They need to live in one repo where a change to a shared type is checked against every part that uses it.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **pnpm workspaces** | One install, shared types across packages, already familiar | None that matter at this size |
| B | pnpm workspaces plus Turborepo | Build caching across packages | More configuration than an 18-day project needs |
| C | Separate folders, no workspace | Simple | Only makes sense with two languages; ruled out by choosing TypeScript |

## Decision

**A. pnpm workspaces**, with this layout for William's areas:

| Path | What | Owner |
| --- | --- | --- |
| `apps/web` | Web app (Vite, React) | William |
| `apps/api` | Hono API and jobs | William |
| `packages/contract` | The data contract's types. Every part imports them | Shapes: Furqaan. Folder: shared |
| `packages/valuation` | Valuation engine and backtests | William |

## Consequences

- CLAUDE.md says the data contract's types will live in `contract/` once the layout is chosen. This layout proposes `packages/contract`; Furqaan confirms, since the data contract is his.
- Furqaan chooses the folders for his areas (chain readers, rules compiler, owner wallet contracts, agent loop).
- Whether option ranking and paper runs get their own packages or live in `packages/valuation`, and where shared test fixtures live, is settled when they are built.
- Workspace files (`pnpm-workspace.yaml`, the root `package.json`) are created at scaffold time.
