# apps/api

The Atlas Cloud backend. NestJS 12 + better-auth + Prisma 7 (driver adapter) over PostgreSQL
(PlanetScale Postgres in deployed tiers, docker locally). First client is the Atlas TUI. Local account metadata,
API keys, ordinary secrets, user settings and MCP configuration stay on the machine; explicit
backup actions copy them to/from the API. Signing in transfers Atlas-native provider OAuth
renewal to dedicated cloud-owned connections. Local sessions and assigned sandboxes retrieve
access tokens, never refresh tokens, from that authority. Persistent ownership survives signout
and outages; a stale local seed is never a fallback refresher. Model requests still go directly
to providers. MCP OAuth is separate and remains local; memory is never a synced domain.

**The API provisions Atlas Cloud sandboxes, with the workspace's own Vercel credentials.** A web
thread's first message calls `POST /v1/threads/:threadId/sandbox`
(`src/api/cloud/sandbox-provisioning/`). The API resolves the thread's project, then that project's
workspace credential (`WorkspaceVercelCredential`: token + team) and the project setting
`sandbox.vercelProjectId` through `ScopedConfigService.vercelCredentials`. It creates the sandbox,
launches serve under `BackgroundWork.keepAlive`, and answers `booting | running | not-configured`
at once. A thread with no project, or a workspace or project missing a piece, gets a Provision
error event that names where to fix it. It never falls back to another identity. Atlas Cloud's own
Vercel account never pays for user compute: the API env `VERCEL_*` are only the legacy fallback
that `SandboxCredentials` (`src/_core/ports/sandbox-credentials.ts`) uses to inspect and stop BYO
rows the TUI created (rows whose thread has no project). They are never used to create a sandbox.

An API-provisioned sandbox carries **no** Vercel credentials in its environment
(`mountWithRetries({ injectVercelCredentials: false })`), because the agent can read anything in
the pod and the token belongs to the whole workspace. Its serve sees `ATLAS_API_PROVISIONED=1` and
asks the API for what used to need the token: `POST /v1/sandboxes/self/ports` to publish a port,
`POST /v1/sandboxes/self/stop` to park itself. Both take the sandbox session token. The API acts
with the credential it resolves per thread.

Boot progress is a thread event (`sandbox-boot-step`, `bootStepEventSchema` in
`packages/wire/src/boot-progress-wire.ts`) on run `run_sandbox-boot`. The API appends Provision
and Serve. Serve cannot report its own download, so it appends Clone, Context, Settings and Agent
with its sandbox token.

The TUI still provisions its own BYO sandboxes with the operator's token and registers them
through `POST /v1/sandboxes`. That path is unchanged and frozen with the TUI. OAuth-bearing lifts
assign scoped connection access before serve starts. The API also provides identity, optional
remote-control rendezvous, thread discovery, backup sync and PR/CI webhooks.

## Runtime and tests

This package runs on **Bun** (`bun src/main.ts`, ESM, no build step) and tests with **vitest**, not
`bun test`. Bun runs Nest's constructor `@Inject(...)` decorators under this package's tsconfig;
`test/bun-runtime.spec.ts` spawns the real app under `bun` and fails if one is dropped. vitest
needs `unplugin-swc` with `legacyDecorator` + `decoratorMetadata` to emit decorator metadata (see
`vitest.config.mts`), and aliases `@dltech/atlas-wire` to its source because vite does not honor
wire's `bun` export condition.

## Layout

```
src/
  _core/      kernel: env module, decorators, ports, types. Imports nothing from slices.
  _lib/       infra adapters (crypto). Framework-light.
  _module/    shared injectable modules (session guard + verifier port).
  api/        the deployable app: app.module.ts + feature modules in two layers —
              platform/ (auth, accounts, sessions, sandboxes, health) and cloud/ (secrets,
              mcp-servers, user-context, github). One-way rule:
              cloud may import platform, platform never imports cloud;
              enforced by src/api/architecture.spec.ts.
  db/         the lazy `db` client proxy + generated-client type re-exports.
  create-app.ts  composes the Nest app (parsers, pipes, filters) and inits it; never listens.
  main.ts     the long-lived server — hydrates env from the tier file when a DOTENV_PRIVATE_KEY
              is present, validates env, createApp(), graceful shutdown, listen.
  vercel.ts   the Vercel function entry — decrypts the shipped tier (vercel-tier-env.ts),
              validates env, createApp(), default-exports the Express instance.
build.ts      bundles vercel.ts into a Build Output API v3 directory (see "Vercel bundle").
prisma/       schema + migrations only (the client wrapper moved to src/db).
envs/         dotenvx tier files (.env.api.<tier>.enc, committed; .env.keys, never).
test/         cross-cutting specs (env alignment).
```

Imports are plain relative paths — this package has no path aliases on purpose. tsc never
rewrites them, and every downstream toolchain (bundlers, tracers, containers) has broken on
them at least once; relative imports work everywhere. Do not reintroduce them.

## Request bodies

The API stores no context archives: context goes straight into the sandbox from the client, and
the old upload endpoints are gone. The global JSON body cap is 4 MB (`JSON_BODY_LIMIT` in
`src/_lib/body-limits.ts`) because Vercel rejects requests over 4.5 MB before the app sees them,
so no route gets a larger parser. User-layer uploads fit because the harness skips files over
3,000,000 bytes (`MAX_USER_LAYER_FILE_BYTES`), whose base64 body is 4,000,000 bytes.

## Deploy

DigitalOcean App Platform, git-connected to main: `apps/api/Dockerfile` (multi-stage, repo-root
build context; the runtime image is `node:22-slim` plus the `bun` binary — the server runs
`bun src/main.ts`, while the PRE_DEPLOY migrate job needs node, npm, dotenvx and the prisma CLI) + `.do/app.yaml` (app spec: api service on port 3400 with a PRE_DEPLOY migrate
job, region nyc). The only env the platform needs is `APP_TIER`, `MIGRATE_TIER` and
`DOTENV_PRIVATE_KEY_API_PRODUCTION` — the tier file in the image carries the rest.

The Dockerfile's runtime stage copies explicit paths (`src`, `envs`, `prisma`, `scripts`,
`prisma.config.ts`, `tsconfig.json`) — anything a package script loads by path must be added to that list or it
exists locally and 404s in the deploy. CI builds this image (`build-api-image` in `ci.yml`), so
a missing copy fails the PR rather than only at deploy.

**`.do/app.yaml` is not read on push.** App Platform reads a spec file only when an app is
created or updated through the API/CLI, so committing a change to it changes nothing on its own
— the live spec is whatever was last applied. Migrations silently stopped running for exactly
this reason: the `migrate` job existed in the file and never in the app.

The file is a mirror of the live spec, not a wish. It was not, once: it named an app `atlas-api`
with a service `api` on port 3400, while the live app is `atlas` with `atlas-apps-api` on 8080,
and it carried neither the `api.byatlas.io` domain nor the alerts. Applying that would have
renamed both, moved the port and dropped the domain — `apps update --spec` replaces the spec
rather than merging into it. Take the live spec as the base for any edit and keep the diff to
what you mean to change.

```
export DO_APP_ID=<app id>
bun run do:spec:diff     # live spec vs .do/app.yaml — run this when either changes
bun run do:spec:apply    # backs the live spec up, then doctl apps update --spec
```

`apps update --spec` replaces the whole spec rather than merging into it, so read the diff
before applying: anything the control panel holds and the file does not is dropped. `apply`
writes the live spec to `.do/live-spec.backup.yaml` (git-ignored) first, which is what you feed
back to `--spec` to undo.

PRE_DEPLOY jobs are API/CLI-only; the control panel cannot create one, and a spec edited there
can drop it. Diff before you trust it.

Applying the spec is not proof it works. Confirm the job is both present and running:

```
doctl apps get "$DO_APP_ID" --format Spec | grep -A2 'kind: PRE_DEPLOY'
doctl apps list-deployments "$DO_APP_ID" --format ID,Phase,Created | head -3
doctl apps logs "$DO_APP_ID" migrate --type run --deployment <id>
```

The migrate logs of a healthy deploy read `N migrations found` then either the migrations it
applied or `No pending migrations to apply.` A deployment whose `Phase` is `ERROR` with the job
having exited non-zero is the gate working, not a regression: the previous release is still
serving and the schema was never half-applied.

**What the job buys.** A PRE_DEPLOY job runs to completion before the new containers start, and
a non-zero exit cancels the deployment with the previous release still serving. The migrate job
is the only thing that applies schema in a deployed tier — never the app container, which holds
no DDL rights by design. Locally the same command is `MIGRATE_TIER=production bun run
db:migrate:deploy`.

The job connects through `DIRECT_URL` (PlanetScale's direct endpoint, :5432; `DATABASE_URL` is its
PgBouncer on :6432) when the tier supplies one,
falling back to `DATABASE_URL` — `prisma migrate deploy`'s session-level advisory lock does not
survive the pooler: a killed job once left the lock pinned on a pooled backend and every later
deploy timed out acquiring it (P1002). `scripts/migrate-deploy.mjs` also retries the deploy
three times with a 20s backoff, so two overlapping PRE_DEPLOY jobs no longer fail a deployment.

`.github/workflows/migrate-production.yml` applies migrations on merges to main that touch
`prisma/migrations`, `prisma/schema.prisma` or the workflow itself, through `DIRECT_URL`, and can be
run by hand with `workflow_dispatch`. While DigitalOcean is live it runs alongside the PRE_DEPLOY
job, safely: `prisma migrate deploy` is idempotent, takes an advisory lock, and
`scripts/migrate-deploy.mjs` retries on contention. After cutover it is the only migration path,
and the additive-migration and rollback rules below still apply.

**Rollback does not unwind a migration.** App Platform can restore any of the last ten
successful deployments, and it restores code, configuration and the app spec — never database
data. It is control-panel only: Apps → the app → Activity → Rollback. `doctl apps` has no
rollback subcommand, and the deployment must share the app's region and database configuration. Prisma has no down-migrations either. So every migration must be backward-compatible with
the release it lands ahead of: add columns with defaults, add tables, never rename or drop in
the same deploy as the code that stops using them. A `FAILED_DEPLOY` job that ran down-DDL would
turn a failed deploy into data loss; there is deliberately none.

The database half of a rollback is PlanetScale's backups. A restore never happens in place: pick
a backup or a point in time (up to 5 minutes ago) under Backups and restore it to a **new
branch**, reset the role password there, then `dotenvx set` both URLs to the new branch's host
and redeploy. It reaches only as far back as the backup retention (2 days on the default
schedule), so check that window is wider than the gap between a bad migration landing and
someone noticing. https://planetscale.com/docs/postgres/backups/point-in-time-recovery

`GET /v1/health` answers 503 when the running build expects migrations the database has not
applied, so drift fails the health check and DO holds the previous release rather than serving
500s. A database it cannot reach is reported as `unknown` and stays healthy — a cold start is
not drift.

## Vercel bundle

`bun run build` (`prisma generate`, then `build.ts`) writes `.vercel/output`: `Bun.build` bundles
`src/vercel.ts` into one `index.js` (`target: 'bun'`, ESM), plus `config.json` routing everything to
the function and `.vc-config.json` (`runtime: bun1.x`, `launcherType: Nodejs`). The committed
`envs/.env.api.production.enc` is copied into the function; Vercel holds only
`DOTENV_PRIVATE_KEY_API_PRODUCTION`, and `DOTENVX_ENVS_DIR=.` in `.vc-config.json` makes
`vercel-tier-env.ts` decrypt it at boot (fatal if the file is missing or any value stays
`encrypted:`). The migration directory names are inlined at build time as
`__ATLAS_SHIPPED_MIGRATIONS__`, because the bundle has no `prisma/migrations` directory for
`shippedMigrationNames()` to read.

The build follows comp-neo's pattern. `OPTIONAL_IMPORTS` in `build.ts` stays external: the lazy
imports of NestJS and its libraries (the NestJS bundling guide's list) that this API never installs.
`class-validator` and `class-transformer` stay bundled. `@thallesp/nestjs-better-auth` loads express
with `createRequire()`, which `Bun.build` cannot follow, so `RUNTIME_PACKAGES = ['express']` is
external too and is installed beside the bundle: `build-runtime-packages.ts`
(`lockedRuntimePackages`) pins express and its full dependency graph from the repo `bun.lock`
(`lockfileVersion` 3), `build.ts` writes that as `index.func/package.json` and a trimmed `bun.lock`,
then runs `bun install --production --linker hoisted --frozen-lockfile --os=* --cpu=*` in the
function directory. Any other unresolved import fails the build.

`src/vercel-bundle.integration.spec.ts` builds the real output and serves the function directory
from a `docker run --read-only` container of the same Bun image the Dockerfile pins
(`test/bundle-container.ts`), with HOME on the read-only mount — the way Vercel's filesystem sees
it, so a package the bundle left out fails the spec instead of resolving from `node_modules`. A
host-side run cannot stand in for this: `bun --no-install` hides auto-install, and a read-only HOME
on macOS still finds a writable cache. It runs against a throwaway `postgres:17-alpine` container on
a spec-owned network and hits health, 401, bearer-authenticated, DTO validation, better-auth and the
HMAC webhook. It runs only with `ATLAS_LIVE_DOCKER=1` (CI sets it) and is skipped otherwise. Run it
after adding any module or dependency: it is what catches an import the bundle misses.

Bun auto-installs any package it cannot resolve at import time, and on a read-only filesystem that
write kills the process instead of throwing a catchable resolve error. The function ships no
`bunfig.toml`: with a `node_modules` next to the bundle Bun does not auto-install, and the read-only
spec passes 8/8 without one, so the lazily imported externals fail as ordinary, caught resolve errors.

Work that must outlive the response goes to `BackgroundWork.keepAlive` (`src/_core/ports/background-work.ts`),
because a Vercel instance can freeze once the response is sent. `backgroundWorkProvider()` binds
`waitUntil` from `@vercel/functions` when `VERCEL === '1'` and a no-op otherwise. First-message
provisioning boots ride it, and so do wake boots. Both share `VercelSandboxWakeBoot`, which mounts,
launches serve and rolls back a sandbox it created when the boot fails. A boot can outlive one
response: a sandbox create plus the serve download can approach the function's `maxDuration`.
`GithubSandboxWakeService` hands every tracked lookup and boot to `keepAlive`, and the
wake debounce is 0 on Vercel (the `wakeClaim` CAS dedupes events and instances), so the boot starts
inside the kept-alive lookup chain. The trigger.dev worker passes `ProcessBackgroundWork` and the
5 s debounce and relies on `settle()`.

The comp-ai Vercel project `atlas-api` is git-connected (production branch `main`, root
`apps/api`, no domain), so every affected merge builds a Vercel production deployment. Its
`*.vercel.app` URLs sit behind Comp AI's SSO, so smoke-test them with the project's protection
bypass header. `api.byatlas.io` still points at DigitalOcean until cutover, so the Deploy
section above is still the live path.

## Auth

better-auth is mounted through `@thallesp/nestjs-better-auth` in `src/api/platform/auth/auth.module.ts`,
with `organization`, `bearer`, and `deviceAuthorization` plugins. Guards never import
better-auth: they depend on the `SESSION_VERIFIER` port (`src/_core/ports/session-verifier.ts`),
bound by `SessionModule.withVerifier(...)`. Feature routes opt into protection with
`@UseGuards(SessionAuthGuard)` and opt out with `@Public()`.

The device-authorization flow is how the TUI logs in. The pages live in `apps/web` (Vercel,
`byatlas.io`); the API only exposes the better-auth endpoints, and `WEB_ORIGIN` is what points
the device `verificationUri` at the web app. The device page must claim the code
(`GET /api/auth/device?user_code=…`) while signed in before approve/deny will work.

## GitHub identity is an OAuth App; webhook transport may be a GitHub App

GitHub connect (user auth) uses the device flow against a plain **OAuth App** (`GITHUB_CLIENT_ID`).
That is per-user delegation: the API and sandboxes act with the user's own permissions, so nothing
is ever installed on a repo or org for auth. A GitHub App would invert that for auth — user tokens
become the intersection of user access, app permissions, and installation coverage (repo 404s for
an uninstalled repo), the device flow ignores the requested scopes, and user-to-server tokens
expire after 8 hours. `pollConnect` therefore refuses a grant whose `scope` is missing any of
`repo read:org admin:repo_hook admin:ssh_signing_key` (an `admin:X` grant satisfies `write:X` and `read:X`), instead of storing a token that can only ever see public repos. `admin:ssh_signing_key` is listed because `DELETE /user/ssh_signing_keys/{id}` needs `admin:` and rotate/revoke of the commit-signing key deletes the old one; older connections keep working for everything else and get `github-signing-scope-missing` from `/v1/ssh-signing-key` until they reconnect.

**Webhook transport is separate, and there a GitHub App is allowed.** A per-repo personal webhook
needs the subscribing user to be a repo admin; on an org repo where they are not, PR events
(`pull_request_review`, `pull_request_review_comment`, `issue_comment`) are degraded to polling and
inline review comments never arrive. The Atlas GitHub App (`GITHUB_APP_SLUG`, owned by
`dennisofficial`) fixes that: any org admin installs it once, GitHub delivers the app's webhook to
`POST /v1/github/app/hook` (verified with `GITHUB_APP_WEBHOOK_SECRET`), and the delivery routes to
subscribers exactly like a per-repo hook. Routing precedence per repo: app installation > personal
hook > poll-backed. User auth stays OAuth — the app is transport only, and the two never mix.

## Env

House dotenvx conventions (see the `env-conventions` skill): encrypted per-tier files in
`envs/`, `.env.keys` and `.env.personal` git-ignored, key parity across tiers enforced by
`test/env-alignment.spec.ts`. Add a variable in lockstep: the right `sections/*.ts` Joi rule +
interface field, then the key line in every tier file (commented with a recognized reason where
a tier does not supply it), then `dotenvx set` to fill values in place. Typed access is
`env.get('KEY')` via `EnvService`; never read `process.env` in app code (sanctioned exceptions:
`main.ts` bootstrap and `auth.server.ts`, which construct before Nest DI exists).

Local boot: `bun run db:up` (docker Postgres on 5433), `bun run db:migrate`, `bun run dev`.
Migrations run through `db:migrate` (dotenvx-injected); in deployed tiers they run via
`db:migrate:deploy` with `MIGRATE_TIER` set, never from the app container.

## Redis

`src/_lib/redis` (`RedisService`, `RedisModule`) is the one Redis seam: nothing else constructs an
ioredis client. `client()` is the shared, lazy command connection; a subscriber takes its own
connection from `duplicate()` (a subscribed connection answers only pub/sub commands) and owns
its teardown. Nothing durable goes in Redis — Upstash is a bus with eviction on, so state that
must survive lives in Postgres and Redis only carries notifications. Local dev runs without it:
`REDIS_URL` is unset in the local tier, `isConfigured()` is `false`, and callers
choose local-only behaviour; `client()` and `duplicate()` throw rather than reach for localhost.

## Background jobs

trigger.dev is a required platform for this package, not an optional add-on. Tasks live under
`src/trigger/<feature>/`, configured by `trigger.config.ts` (`dirs: ['./src/trigger']`, runtime
`node-24`, `maxDuration: 300`). The project is **Atlas** (`proj_yvwotwceptrneuuasamk`, org DL
Technologies LLC). The SDK, `@trigger.dev/build` and the `trigger.dev` CLI are pinned together at
one exact version; bump all three at once.

- **One dispatch seam.** API code enqueues work through `JobDispatcher`
  (`src/_core/ports/job-dispatcher.ts`), bound globally by `TriggerModule`
  (`src/_lib/trigger/`). `dispatch({ task, payload, idempotencyKey, tags })` returns `{ runId }`.
  Any SDK failure, or a payload the contract's schema rejects, throws `JobDispatchError` carrying
  the task id. Nothing ever falls back to running the work in-process. `trigger-job-dispatcher.ts` is
  the only file in `src/api` or `src/_lib` that imports `@trigger.dev/sdk`, and nothing outside
  `src/trigger` imports worker code. `src/api/trigger-boundary.spec.ts` enforces both rules.
- **Contracts are owned by the caller.** A task's id, zod payload schema and
  `Task<id, payload, output>` type live in a contract file next to the feature that dispatches it,
  exported as a `TaskContract`. The worker task `satisfies` that type, so the two stay in step
  without the API depending on the worker's graph. `src/trigger/smoke/smoke.contract.ts` is the
  exception: only CI dispatches `atlas-smoke`, so its contract sits beside the task.
- **`TRIGGER_SECRET_KEY` is required.** A missing key fails boot. Local uses the dev-environment
  key (`tr_dev_…`) and production uses the prod key. Specs and the CI image probe use a fixture.
- **Worker env is the tier.** `trigger-tier-extension.ts` ships `envs/.env.api.production.enc` in
  the worker bundle, and `src/trigger/init.ts` decrypts it into `process.env` before any task
  loads (`tier-env.ts` is fatal on a missing file or any value left `encrypted:`). The dashboard
  holds only `DOTENV_PRIVATE_KEY_API_PRODUCTION`; never paste an app secret into it.
- **Tasks build their service graph by hand**, outside Nest DI and once per run
  (`src/trigger/github/github-sweep-graph.ts`): plain constructor chains over an `EnvService` built
  from the validated `process.env`. The fan-out gets a `RedisPrFrameBus` when the tier carries
  `REDIS_URL`, else a `LocalPrFrameBus`; a worker only publishes, since it never calls `openStream`.
  Test a task by calling its run function directly with a stubbed graph or db
  (`github-sweep.tasks.spec.ts`, `smoke.task.spec.ts`).
- **Local dev.** `bun run dev` runs the API and `trigger dev --profile atlas` together under one
  `env:inject`; when either exits, both stop. Dispatched runs execute only while that worker is up.
  `bun run dev:no-trigger` is the API alone, for work that dispatches nothing.
  `trigger:dev` runs only the worker.
- **Deploy is automatic.** `.github/workflows/deploy-trigger.yml` deploys to prod on every merge to
  main that touches the API's build closure, serialized and never cancelled. It runs `db:generate`
  first, because the generated client is gitignored and the bundle fails without it. The CLI
  authenticates with the `TRIGGER_ACCESS_TOKEN` repo secret (a `tr_pat_` personal token) and takes
  the project from `trigger.config.ts`. The job then decrypts the prod `TRIGGER_SECRET_KEY` and runs
  `scripts/trigger-smoke.ts`, which dispatches `atlas-smoke` (`SELECT 1` through the worker's db)
  and fails unless the run completes within two minutes. PRs get no deploy dry-run: `trigger deploy
  --dry-run` authenticates and fetches project env vars before it bundles, and PR code never
  receives the token. A manual deploy is `bun run db:generate && bun run trigger:deploy`.
- **Bundling:** `@dltech/atlas-wire` resolves through its `bun` export condition, so
  `trigger.config.ts` sets `conditions: ['bun']`. `@prisma/client` must stay external
  (`prismaExtension({ mode: 'modern' })`): bundled, esbuild re-exports its CJS query-compiler
  `wasm-base64` module as a default only, the generated client's `const { wasm } = await import(...)`
  gets `undefined`, and every query fails with `Buffer.from(undefined)`. `@prisma/adapter-pg`, `pg`
  and ioredis bundle. `bun run trigger:deploy -- --dry-run` proves the build but not the runtime;
  the smoke step is what proves the runtime. `src/vercel.ts` must never import `src/trigger/`.
- **Until cutover, in-process timers stay.** `GithubSweepSchedulerService` owns the 30 s and 60 s
  `@Interval`s and `ScheduleModule` is imported only when `VERCEL !== '1'`, so DO and `bun run dev`
  keep sweeping while Vercel instances never run timers. A double run (DO timers plus the
  schedules) is harmless: both sweeps are idempotent.

## Rules that differ from the rest of the repo

- vitest unit specs are colocated `*.spec.ts`; they never touch a real database (CI has none).
  `src/db`'s `db` is a lazy proxy, so importing it is safe; constructing queries is not.
- Everything else from the root CLAUDE.md still applies: 300-line files, no `as any`, no
  ts-ignore, E-prefixed enums, `handle`-prefixed handlers, named parameters, no comments that
  restate the code.
