# apps/trigger

The v2 background-job app. Every v2 job, cron and sweep is a trigger.dev task defined under
`src/trigger/`, deployed here rather than from the API. Task ids and zod payload schemas live in
`@dltech/atlas-jobs` (`packages/jobs`), which both this app and the API import; this app never
imports `apps/api`, and `apps/api` never imports this one. See
[docs/decisions/0022-v2-background-jobs-in-apps-trigger.md](../../docs/decisions/0022-v2-background-jobs-in-apps-trigger.md).

## Its own trigger.dev project

This app deploys to the trigger.dev project **Atlas v2** (`proj_muqwamionbikynuchupc`, org
DL Technologies LLC), configured in `trigger.config.ts`. That is a different project from v1's
`proj_yvwotwceptrneuuasamk`, which `apps/api` still deploys: the two share no task ids, no schedules
and no secrets, and retiring v1 deletes its project whole. Until v1 retires there are two
deployments.

## Operator steps

1. The trigger.dev project already exists. Nothing to create.
2. Set the deploy key. `trigger deploy` authenticates from `TRIGGER_SECRET_KEY`, a key minted for
   **Atlas v2** in the trigger.dev dashboard (Project settings → API keys). Use its development key
   locally and its production key in CI.
3. Store the production key as the repo secret `TRIGGER_V2_SECRET_KEY`, the way
   `.github/workflows/release.yml` takes v1's keys from repo secrets:

   ```sh
   gh secret set TRIGGER_V2_SECRET_KEY
   ```

   `.github/workflows/trigger-v2.yml` deploys with that secret and nothing else — no project ref
   variable, because the ref is in `trigger.config.ts`.
4. Set `DOTENV_PRIVATE_KEY_PRODUCTION_ENC` (from `apps/trigger/.env.keys`) in the Atlas v2
   project's environment variables in the dashboard. The worker needs it to decrypt the tier file
   at start; the dashboard holds only that key, never an app secret.

## Encrypted tier

`apps/trigger/.env.production.enc` is this app's own tier file, with its own keypair, and carries
only what these tasks need: `DATABASE_URL`, the change storage keys (`ARTIFACT_S3_*`), the Blob
token (`BLOB_READ_WRITE_TOKEN`), and the pod keys that `readPodsEnv` from `@dltech/atlas-pods`
reads (`DAEMON_SECRET`, `SECRETS_ENCRYPTION_KEY`, `ATLAS_API_ORIGIN`, `PLATFORM_VERCEL_*`,
`AGENT37_*`), and the GitHub keys the sweeps read (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `BETTER_AUTH_URL`, `REDIS_URL`). A task that reads a new variable adds it here in the same PR. The private key lives in `apps/trigger/.env.keys`,
which is gitignored; deploy targets hold only that key, as `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`.
`trigger-tier-extension.ts` ships the tier file into the worker bundle as `envs/` and points
`DOTENVX_ENVS_DIR` at it; `src/trigger/init.ts` decrypts it into `process.env` before a task runs.
Never add the API's tier file here.

## The GitHub sweeps

`github-hook-sweep`, `github-poll-sweep` and `github-webhook-reconcile` moved here from v1's project
on 23 Nov 2026: they build every service by hand over `@dltech/atlas-github`
(`src/trigger/github/github-sweep-graph.ts`) and leave v1 out, so the outbox drains only the kinds
this app can run. The v1 project keeps `github-v1-wake-sweep`, which refreshes v1 `liveUntil` from
thread activity, retries failed v1 wakes and drains the v1-only outbox kinds. Both projects deploy on
the same merge to main and trigger.dev syncs declarative schedules on deploy, so the three schedules
stop in v1 in the same deploy that starts them here. A short overlap is safe: outbox and inbox claims
use leases and `SKIP LOCKED`, and the hook sweep holds `GithubAppSyncGate`.

## How the API starts a task

The API starts `pod-sleep`, `pod-resize` and `pod-disk-grow-one` by id with this project's key,
`TRIGGER_JOBS_SECRET_KEY` in the API's tier files. Its `TRIGGER_SECRET_KEY` stays the v1 project's
key for the v1 tasks. A task here that queues another task uses the SDK's `tasks.trigger`, which
needs no key inside a worker.

## Local

```sh
export TRIGGER_SECRET_KEY=tr_dev_...
bun run dev
```

`dev` needs the project ref, which is in `trigger.config.ts`, and a development key. Deploy with
`bun run deploy` locally or `bun run deploy:ci` in CI (`--skip-update-check`). Typecheck with
`bun run typecheck`.
