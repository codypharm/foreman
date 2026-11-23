# Deploying Foreman

The steps William follows to put Foreman online, as decided in `docs/decisions/2026-11-23-hosting.md`:
- **Railway** runs the API, the worker and Postgres.
- **Vercel** serves the web app.

Settings live in each provider's dashboard and are written down here, so this page is the record. Agent sessions never deploy and never see a key; every step below is William's.

Do the steps in order. Postgres is filled **before** the API and worker first start, because each of them applies the migrations as it starts, and a restore into tables they created would clash.

## 1. Railway project and Postgres

1. Create a Railway project on the Hobby plan.
2. Add **Postgres** to it. Railway names the service `Postgres`.
3. Under the Postgres service's Variables, note two values:
   - `DATABASE_URL`, the private address that the services use;
   - `DATABASE_PUBLIC_URL`, the public address, used only for the restore in step 2.
4. Check its version: run `select version();` in its Data tab. The local index is Postgres 18.7. If Railway's version is lower, `pg_restore` may print errors about settings the older server doesn't know, such as `transaction_timeout`. Those lines are harmless; any other error stops the steps here.

## 2. Copy the local index into Railway

Run these from the repository root, with Docker running. The dump leaves out:
- the pg-boss queue, which the worker recreates;
- the local worker outcomes, so `/health` on Railway reports only Railway's runs.

It keeps everything else, including `published_results`, the record of what is already on the testnet.

Save the dump in your home folder, never in the repository:

```bash
docker compose exec -T postgres pg_dump -U foreman -d foreman -Fc --exclude-schema=pgboss --exclude-table-data=worker_stages > ~/foreman-index.dump
```

Restore it into Railway's Postgres, with `DATABASE_PUBLIC_URL` from step 1 pasted in place of `<DATABASE_PUBLIC_URL>`:

```bash
docker compose exec -T postgres pg_restore --no-owner --no-acl -d "<DATABASE_PUBLIC_URL>" < ~/foreman-index.dump
```

On 23 Nov 2026 the dump was 16 MB and took 2 seconds to write; the restore depends on your upload speed. When it's done, Railway's Data tab shows the tables. `index_state` holds the block your local index had reached; the worker carries on from there.

## 3. The API service

1. Add a service from the GitHub repository: **New → GitHub Repo → foreman**. Railpack builds it from the repository root with pnpm; there is no build step.
2. Name it `api`. If Railway created the service by itself from the repository, it may have guessed it was the web app and filled in **Settings → Build** with a build command (`pnpm --filter @foreman/web build`) and a watch path (`/apps/web/**`). Empty both. With the watch path, a push that doesn't touch `apps/web` is skipped, and the API stays on old code (seen on 23 Nov 2026).
3. **Settings → Deploy → Custom Start Command:** `pnpm --filter @foreman/api serve`
4. **Settings → Networking → Generate Domain.** This is the API's public address, used in step 5.
5. Leave the **healthcheck path empty**, not `/health`: a fresh deploy answers 503 there until the worker's first run, and Railway would refuse a good deploy.
6. **Variables:**

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway's reference to the database) |
   | `BNB_ARCHIVE_RPC_URL` | the NodeReal URL from your `.env`, as a **sealed** variable |
   | `BNB_ARCHIVE_LOG_BLOCKS` | `50000` |
   | `RAILPACK_NODE_VERSION` | `24` (the root `package.json` says only `>=24`) |

   Railway sets `PORT` itself.

## 4. The worker service

1. Add a second service from the same repository; name it `worker`. Check **Settings → Build** as for the API: no build command, no watch paths.
2. **Custom Start Command:** `pnpm --filter @foreman/api worker`
3. No domain and no healthcheck: it serves nothing.
4. **Variables:** the same four as the API, plus:

   | Name | Value |
   | --- | --- |
   | `PUBLISHER_KEY` | the publisher wallet's key, as a **sealed** variable, written `0x` and 64 hex characters. Testnet only (hosting ADR, decision 4). Leave it out to run without publishing |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `130`. Railway gives an old deployment **0 seconds** after the stop signal before killing it, unless this says otherwise. The worker asks for up to 2 minutes to finish a run, so this gives it 130 seconds |

5. The publisher wallet pays testnet gas on every run that publishes, so keep some test OKB in it. Each publish run reads its balance; under 0.05 OKB, `/health` answers 503 `"low-balance"` (`docs/decisions/2026-11-23-low-balance-warning.md`). On 23 Nov 2026 one publish of 61 results cost 0.0001 OKB.

On start, the worker logs `worker started: follow-refresh-publish every 5 minutes (UTC)`, then one line per stage for each run. The first run catches up from the dump's block, then a normal run takes about 40 seconds.

## 5. The web app on Vercel

1. **Add New → Project →** import the GitHub repository.
2. **Root Directory:** `apps/web`. Vercel finds the pnpm workspace and installs it.
3. **Framework Preset:** Vite. Build command `pnpm build`, output `dist` (the defaults for that preset with this `package.json`).
4. **Environment Variables:**

   | Name | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://` followed by the API domain from step 3 |

   It's public: it's built into the page. Never put a key in a `VITE_` variable.
5. Deploy. The app uses hash routes (`#/circuit/…`), so it needs no rewrites.

The API allows any site to read it, so no change is needed for Vercel's domain.

## 6. Check it

- `https://<api domain>/health` answers 200 with `"status":"ok"` once the worker's first run finishes, and `"publish":{"health":"not-publishing"}` if there's no key. It answers 503 and `"behind"` when a stage hasn't finished in 30 minutes, and 503 and `"low-balance"` when the publisher wallet holds under 0.05 OKB; `publisher` shows its address and balance. Compare `index.upToBlock` with `index.resultsUpToBlock`: a gap that keeps growing means the refresh is skipping circuits.
- The Vercel address shows today's listings. A result page's "Read it back from the contract" reads the testnet directly from the browser.
- The worker's logs show each run's stages and any publish transaction hashes.

## Afterwards

- **A push to `main`** redeploys both Railway services and the Vercel app. The worker gets up to 2 minutes to finish a run before it stops; an interrupted run is safe, and the next one picks up.
- **Delete `~/foreman-index.dump`** once the restore is checked.
- **An uptime checker watches `/health`** (hosting ADR, decision 7): an UptimeRobot HTTP monitor, "Foreman worker", on `https://<api domain>/health` every 5 minutes, emailing William when it answers anything but 200. Set up on 23 Nov 2026. The email doesn't say why; open `/health` to see `status` and `publisher`.
- **The web app's address** on 23 Nov 2026: `https://foreman-eight-beta.vercel.app/`.
