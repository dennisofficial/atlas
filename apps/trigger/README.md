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
only what these tasks need (`DATABASE_URL`). The private key lives in `apps/trigger/.env.keys`,
which is gitignored; deploy targets hold only that key, as `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`.
`trigger-tier-extension.ts` ships the tier file into the worker bundle as `envs/` and points
`DOTENVX_ENVS_DIR` at it; `src/trigger/init.ts` decrypts it into `process.env` before a task runs.
Never add the API's tier file here.

## Local

```sh
export TRIGGER_SECRET_KEY=tr_dev_...
bun run dev
```

`dev` needs the project ref, which is in `trigger.config.ts`, and a development key. Deploy with
`bun run deploy` locally or `bun run deploy:ci` in CI (`--skip-update-check`). Typecheck with
`bun run typecheck`.
