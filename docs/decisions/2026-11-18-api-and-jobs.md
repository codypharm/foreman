# API and jobs: Hono on Node, Postgres, pg-boss

- **Date:** 18 November 2026
- **Status:** Accepted
- **Decided by:** William
- **Depends on:** `2026-11-18-language.md` (TypeScript everywhere)

## Context

The API serves the web app (miner page, decision screen, rules screens, action log) and later the Telegram bot. The jobs keep data fresh: reading new claim events every few blocks, refreshing X Layer offers, running paper runs, and hosting Furqaan's agent loop when it exists.

Two facts shape it:

- Public BNB Chain nodes serve `eth_getLogs` only in 200-block chunks, and several refuse or reset connections. Backfilling a miner's claim history is many small calls that must be batched, retried and cached by block.
- CLAUDE.md requires every valuation to show its block number, so cached chain data has to be stored with the block it came from.

## Options

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Hono on Node, Postgres, pg-boss for jobs** | One database holds the block cache, offers, paper runs, the action log and the job queue. Long backfills run as ordinary processes. Hono is small and written for TypeScript | Needs a host that keeps a process running |
| B | Cloudflare Workers, Cron Triggers and D1 | Cheap, quick to deploy | Backfills made of hundreds of 200-block chunks run into the Workers time limits; work has to be split across many invocations |
| C | FastAPI with APScheduler | Good if the engine were Python | Ruled out by choosing TypeScript |

Within A, Hono was chosen over Fastify. Fastify has the more mature plugin ecosystem; this project needs few plugins, and Hono is lighter with types built in.

## Decision

**A. Hono running on Node, Postgres as the single database, pg-boss as the job queue.**

## Consequences

- Jobs are retried by pg-boss, and a job that fails reports a clear error. A failed chain read never becomes a zero (CLAUDE.md, "Bad input").
- Chain data is stored with its block number, so a valuation can cite it and a reorg can be handled by block.
- Hosting is not decided. It needs Node and Postgres with a long-running process. Agents do not deploy; a human does.
- The database access library and migration tool are chosen at scaffold time.
