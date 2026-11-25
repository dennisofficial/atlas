# apps/trigger

The background-job app. Every job, cron and sweep is a trigger.dev task defined under
`src/`, deployed here rather than from the API. Task ids and zod payload schemas live in
`@dltech/atlas-jobs` (`packages/jobs`), which both this app and the API import; this app never
imports `apps/api`, and `apps/api` never imports this one. See
[docs/decisions/0022-v2-background-jobs-in-apps-trigger.md](../../docs/decisions/0022-v2-background-jobs-in-apps-trigger.md).

## Its own trigger.dev project

This app deploys to the trigger.dev project **Atlas v2** (`proj_wcjbubibkotgsclldnyz`, org
Comp AI), configured in `trigger.config.ts`. It is the only trigger.dev project Atlas deploys: v1's
`proj_yvwotwceptrneuuasamk` has no code to deploy any more (see `docs/slices/v1-retirement.md`,
slice 3).

## Operator steps

1. The trigger.dev project already exists. Nothing to create.
2. Set the deploy token. `trigger deploy` authenticates from `TRIGGER_ACCESS_TOKEN`, a `tr_pat_`
   personal token of a Comp AI org member. CI reads it from the repo secret
   `TRIGGER_ACCESS_TOKEN`:

   ```sh
   gh secret set TRIGGER_ACCESS_TOKEN
   ```

   `.github/workflows/trigger.yml` deploys with that secret and nothing else — no project ref
   variable, because the ref is in `trigger.config.ts`.
3. The API dispatches with the project's API key, `TRIGGER_JOBS_SECRET_KEY` in the API's tier files
   (production key in `.env.production.enc`, development key in `.env.local.enc`).
4. Set `DOTENV_PRIVATE_KEY_PRODUCTION_ENC` (from `apps/trigger/.env.keys`) in the Atlas v2
   project's environment variables in the dashboard. The worker needs it to decrypt the tier file
   at start; the dashboard holds only that key, never an app secret.

## Encrypted tier

`apps/trigger/.env.production.enc` is this app's own tier file, with its own keypair, and carries
only what these tasks need: `DATABASE_URL`, the change storage keys (`ARTIFACT_S3_*`), the Blob
token (`BLOB_READ_WRITE_TOKEN`), and the pod keys that `readPodsEnv` from `@dltech/atlas-pods`
reads (`DAEMON_SECRET`, `SECRETS_ENCRYPTION_KEY`, `ATLAS_API_ORIGIN`, `PLATFORM_VERCEL_*`,
`AGENT37_*`), and the GitHub keys the sweeps read (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `BETTER_AUTH_URL`, `REDIS_URL`), and the preview keys the
reconciler reads (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and
optionally `PREVIEW_DOMAIN`). A task that reads a new variable adds it here in the same PR. The private key lives in `apps/trigger/.env.keys`,
which is gitignored; deploy targets hold only that key, as `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`.
`trigger-tier-extension.ts` ships the tier file into the worker bundle as `envs/` and points
`DOTENVX_ENVS_DIR` at it; `src/init.ts` decrypts it into `process.env` before a task runs.
Never add the API's tier file here.

## The GitHub sweeps

`github-hook-sweep`, `github-poll-sweep` and `github-webhook-reconcile` moved here from v1's project
on 23 Nov 2026: they build every service by hand over `@dltech/atlas-github`
(`src/github/github-sweep-graph.ts`), so the outbox drains only the kinds this app can run. Rows the
v1 project queued under its own kinds stay in `GithubPrOutbox` unclaimed. Outbox and inbox claims use
leases and `SKIP LOCKED`, and the hook sweep holds `GithubAppSyncGate`.

## The preview tunnels

`preview-reconcile` runs every five minutes. It drives one pass over the pods whose `PreviewTunnel`
row is `Pending`, is `Deleting`, or was never synced — making Cloudflare match the rows and deleting
the tunnels of pods that hold no live session — and then sweeps the `atlas-` tunnels and preview
hostnames that no row owns, older than 30 minutes. The agent host runs the same pass right after it
writes a row, so this task is the backstop, the sweep, and the executor of a teardown that no host
holds. `PREVIEW_SWEEP_DRY_RUN=1` makes the sweep log its plan without deleting, which is the first
pass to run against the existing leaked tunnels.

## How the API starts a task

The API starts `pod-sleep` and `pod-resize` by id with this project's key,
`TRIGGER_JOBS_SECRET_KEY` in the API's tier files. `TRIGGER_SECRET_KEY` belonged to the retired v1
project and went with the v1 request lanes; the API holds `TRIGGER_JOBS_SECRET_KEY` only. A task here
that queues another task uses the SDK's `tasks.trigger`, which needs no key inside a worker.

## Local

```sh
export TRIGGER_SECRET_KEY=tr_dev_...
bun run dev
```

`dev` needs the project ref, which is in `trigger.config.ts`, and a development key. Deploy with
`bun run deploy` locally or `bun run deploy:ci` in CI (`--skip-update-check`). Typecheck with
`bun run typecheck`.
