# Database access: pg with plain SQL, numbered SQL migrations, a packages/index package

- **Date:** 20 November 2026
- **Status:** Accepted
- **Decided by:** William (each recommendation was taken)
- **Settles:** "The database access library and migration tool are chosen at scaffold time" in `2026-11-18-api-and-jobs.md`
- **Builds on:** `2026-11-18-api-and-jobs.md` (Postgres, pg-boss), `2026-11-20-circuit-index.md` (what the index stores, built locally first)

## Context

The circuit index is the first thing Foreman stores. It is built locally in Postgres and moved to the host once hosting is decided (`2026-11-20-circuit-index.md`, decision 7), so the way code reaches the database is chosen now.

## Decisions

### 1. Library: `pg` with plain SQL

*Options:* `pg` with plain SQL; Kysely on top of `pg`; Drizzle.

`pg` is the standard Node driver, and pg-boss already depends on it, so it adds nothing new. Queries are written as SQL and stay visible. Query results aren't type-checked, so every read converts its columns by hand (blocks and ids to `bigint`) and is covered by a test that saves and reads back.

### 2. Migrations: numbered SQL files

*Options:* numbered SQL files and a short runner; node-pg-migrate; the library's own tool.

Table changes are files named `001-….sql`, `002-….sql`, applied in order, each in its own transaction, by a short runner that records which have run. A file that has run is never edited; a change is a new file.

### 3. Location: `packages/index`

*Options:* a new `packages/index`; inside `packages/originality`; in `apps/api`.

The index's storage (the migrations, saving a scan, reading the index back) is its own package, `@foreman/index`. `packages/originality` stays checks with no database, and `apps/api` uses `packages/index` when it is built.

## Consequences

- **New dependency:** `pg` (and `@types/pg` for development). It replaces nothing.
- **Local Postgres:** a `docker-compose.yml` at the root runs it, reachable from this machine only. Its local password is a development value for a container on `127.0.0.1`, not a secret. `.env.example` gains `DATABASE_URL` and `TEST_DATABASE_URL`.
- **Tests:** they run against a real Postgres database whose name ends in `_test`; the test helper refuses any other, because it drops and recreates the schema. Without `TEST_DATABASE_URL` the storage tests are skipped, and say so.
- `CLAUDE.md`: the tech stack row "API and job runner" and the repository layout gain `packages/index`.
