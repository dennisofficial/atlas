# apps/api

The Atlas Cloud backend. NestJS 12 + better-auth + Prisma 8 (`@dltech/atlas-db`, `packages/db`) over PostgreSQL
(PlanetScale Postgres in deployed tiers, docker locally). First client is the Atlas TUI. Local account metadata,
API keys, ordinary secrets, user settings and MCP configuration stay on the machine; explicit
backup actions copy them to/from the API. Signing in transfers Atlas-native provider OAuth
renewal to dedicated cloud-owned connections. Local sessions and assigned sandboxes retrieve
access tokens, never refresh tokens, from that authority. Persistent ownership survives signout
and outages; a stale local seed is never a fallback refresher. Model requests still go directly
to providers. MCP OAuth is separate and remains local; memory is never a synced domain.

Every Atlas-owned client calls the API through tRPC under `/v1/trpc` (`threads.create`,
`sandboxSelf.*`, `models.list` and the rest of the generated `AppRouter`). Only the GitHub webhook
controllers (`POST /v1/github/hooks/:repo`, `POST /v1/github/app/hook`, `GET /v1/github/app/callback`),
`GET /v1/health` and better-auth's `/api/auth/*` remain REST.

**The API provisions Atlas Cloud sandboxes on the thread owner's own Vercel credentials.**
`threads.create` with a `firstMessage` writes the Thread, its first `user-said` Event and the
`CloudSandbox` claim in one transaction, then dispatches the `pod-provision` trigger.dev task
(`src/api/cloud/sandbox-provisioning/`, worker `src/trigger/pod-provision/`), which exits if its
`wakeClaim` was superseded. `threadSandbox.provision` is Retry. Without `firstMessage`
the procedure is unchanged for the TUI. A thread is API-provisioned when it has `SandboxBootStep`
rows; a TUI BYO row (none) is never taken over by a web send or Retry. A TUI local pod registers only its
`LocalPodLease`: it never gets a `Thread` row, `Event` rows or a checkpoint row, and the send and
Retry paths refuse a leased thread with 409.

**The sidebar lists sessions, not threads.** A `Session` owns its main thread, the sub-agent
threads spawned in it, its pod (`CloudSandbox` and `SandboxBootStep` are keyed by `sessionId`) and
the per-conversation fields (project, repo, workspace, execution location, title, pin, archive).
Procedures still take a `threadId` and resolve its session (`sessionOfThread`, and `podSessionOf`,
which walks a teammate's `managedBySessionId` to the session that owns the pod). Create a session
and its main thread with `createSessionWithMainThread`: `Session.mainThreadId` is nullable because
the two rows point at each other. `sessions.list` returns top-level sessions with teammates nested;
`threads.list` returns session main threads only. better-auth's table is `AuthSession`.

A thread's owner is fixed at creation (`Thread.userId`). `ScopedConfigService.vercelCredentials`
resolves the owner's `UserVercelCredential` (`userVercel.*`) with token, team and project id. A
missing piece still creates the thread and message and answers `not-configured` with the gap. The
API env `VERCEL_*` only inspect and stop TUI BYO rows; they never create a sandbox.

An API-provisioned sandbox carries **no** Vercel credentials (`injectVercelCredentials: false`).
Its serve sees `ATLAS_API_PROVISIONED=1` and uses its sandbox token on the `sandboxSelf` procedures:
`exposePort`, `stop`, `bootSteps` (Agent Running is recorded under the thread lock and must succeed
before serve hydrates) and `events` (write-behind, idempotent on `(threadId, seq)`). Boot progress
lives in `SandboxBootStep`, read by the web through `threadPod.status`. Messages sent
while the pod is parked, absent or failed are appended as Events and start a pod; serve hydrates
them at boot. `threadMessages.takeBack` takes back an unrun last message.

The TUI still provisions its own BYO sandboxes and registers them through `sandboxes.claim`,
unchanged and frozen with the TUI. The API also provides identity, remote-control rendezvous,
thread discovery, backup sync and PR/CI webhooks.

**`models.list` (tRPC) serves each user's model list.** `src/api/platform/models/` composes the catalogue from the
user's accounts and, when they hold an active OpenAI OAuth connection, replaces the static OpenAI list with
the live Codex list (`CodexModelsCatalogue`, cached per user in memory for 300 s, revalidated with
`If-None-Match`; a Codex failure returns the static list plus `liveError`). The code lives in harness behind
the one subpath `@dltech/atlas-harness/models`, which the API may import and nothing else of harness;
`src/api/harness-boundary.spec.ts` and `architecture.spec.ts` enforce it, and harness's own subpath guard spec
keeps `node:*`, Bun and the provider SDKs out of everything reachable from it.

## Runtime and tests

This package runs on **Bun** (`bun src/main.ts`, ESM, no build step) and tests with `bun test`.
Bun runs Nest's constructor `@Inject(...)` decorators under this package's tsconfig;
`test/bun-runtime.spec.ts` spawns the real app under `bun` and fails if one is dropped. `bunfig.toml`
preloads `nestjs-preload.ts` first (it settles `@nestjs/common` and `@nestjs/core` before the CJS
`@nestjs/throttler` requires them, working around a Bun loader race that intermittently failed
specs with `require() async module ... is unsupported`), then the shared root `bun-test.setup.ts`
and `test.setup.ts` (env). `bunfig.toml` preloads apply only to `bun test`, not to `bun <file>` children,
so `test/fixtures/bun-di-probe.ts` imports `@nestjs/common` and `@nestjs/core` statically and the app graph
dynamically, like `main.ts` / `create-app.ts` do. Specs mock `../../../db`
with a synchronous `mock.module` factory over a statically imported fake — an `async` factory that
dynamic-imports the fake hangs the file under bun. Fake-timer helpers `advanceTimersByTimeAsync` and
`waitFor` live in `test/fake-timers.ts`; the other vitest-only helpers come from `@dltech/bun-test-shims`.

## Adding a route

Routes are nestjs-trpc routers, not controllers (the only controllers left are health and the
GitHub webhooks).

- Write a `@Router({ alias })` class in the feature module and list it as a provider. Each method is a
  `@Query`, `@Mutation` or `@Subscription` that declares both `input` and `output` as zod schemas
  from `@dltech/atlas-wire`; the generated file may import only `@trpc/server`, `zod` and wire, and
  `packages/api-router/src/__tests__/generated-imports.spec.ts` fails a procedure without `output`.
  Input objects are `z.strictObject`.
- Authenticate with `@UseMiddlewares(SessionMiddleware)` (a user session) or
  `@UseMiddlewares(SessionOrSandboxMiddleware)` (a session, a sandbox token or a pod lease token).
  A procedure opts token kinds in with `meta({ podReachable: true, sandboxReachable: true })` and
  tunes the throttle with `meta({ throttle: { limit, ttlMs } | false })`
  (`src/_module/trpc/procedure-meta.ts`). A sandbox token reaches any procedure whose
  input names a `threadId` in its own thread family, and a threadless one marked
  `sandboxReachable`. A pod token reaches only `podReachable` procedures, never thread-family: mark
  a procedure `podReachable` only for a threadless, user-scoped capability a local pod uses
  (decision 0015).
- The generated `AppRouter` (`packages/api-router/src/generated/server.ts`) is committed. The
  pre-commit hook regenerates it when api or wire sources are staged, the CI `check` job fails on
  drift, and `nestjs-trpc watch` keeps it current in `bun run dev`. Commit what the hook writes.
- Clients import `AppRouter` types from `@dltech/atlas-api-router` and never from `apps/api`: web
  uses its `api` client, harness `createHarnessApiClient`, everything else `createApiClient`.
- Test a router with `createMixedApp` (`src/api/platform/accounts/accounts.router.fixture.ts`) or
  the feature's `*.router.fixture.ts` and supertest against `/v1/trpc/<alias>.<procedure>`.
  Queries are GET with `?input=<json>`, mutations POST the input as the JSON body.

## Layout

```
src/
  _core/      kernel: env module, decorators, ports, types. Imports nothing from slices.
  _lib/       infra adapters (crypto). Framework-light.
  _module/    shared injectable modules (session middleware + verifier port, tRPC middlewares).
  api/        the deployable app: app.module.ts + feature modules in two layers —
              platform/ (auth, accounts, sessions, sandboxes, health) and cloud/ (secrets,
              mcp-servers, user-context, github). One-way rule:
              cloud may import platform, platform never imports cloud;
              enforced by src/api/architecture.spec.ts.
  create-app.ts  composes the Nest app (parsers, pipes, filters) and inits it; never listens.
  main.ts     the long-lived server — hydrates env from the tier file when a DOTENV_PRIVATE_KEY
              is present, validates env, createApp(), graceful shutdown, listen.
  vercel.ts   the Vercel function entry — decrypts the shipped tier (vercel-tier-env.ts),
              validates env, createApp(), default-exports the Express instance.
build.ts      bundles vercel.ts into a Build Output API v3 directory (see "Vercel bundle").
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

Production is the comp-ai Vercel project `atlas-api` (`api.byatlas.io`, root `apps/api`, production
branch `main`, `vercel.json`) over PlanetScale `atlas/main`. Background jobs run on trigger.dev.
Nothing else hosts Atlas.

**A merge to main builds a production deployment at once, but `api.byatlas.io` moves only after
the `migrate-production` Deployment Check passes.** `.github/workflows/release.yml` runs on every
push to main (no path filter, because Vercel requires the check on every production deployment).
Its `migrate-production` job runs `bun run db:migrate:deploy` and then `prisma db verify --strict`
against PlanetScale with `MIGRATE_TIER=production`; Vercel holds the aliasing until that job is
green, so a failed migration leaves the previous deploy serving and the schema never half-applied.
The job name is the Deployment Check name, so keep it unique across workflows. `deploy-trigger`
(see Background jobs) needs `migrate-production` and runs only when the push touched the API's
build closure. Locally the same migration is `MIGRATE_TIER=production bun run db:migrate:deploy`.

The migration is the only thing that applies schema in a deployed tier, never the app, which holds
no DDL rights by design. It connects through `DIRECT_URL` (PlanetScale's direct endpoint, :5432;
`DATABASE_URL` is its PgBouncer on :6432) when the tier supplies one, falling back to
`DATABASE_URL` (`packages/db/prisma.config.ts`): a migration's session-level lock does not survive
the pooler, and a killed job once left the lock pinned on a pooled backend so every later run timed
out acquiring it (P1002). `scripts/migrate-deploy.mjs` retries the deploy three times with a 20 s
backoff. The verify step sets `DATABASE_URL` to `DIRECT_URL` for the same reason.

**Fix forward, never roll back.** A bad deploy is repaired by the next merge, so a migration may
drop or rename in the same deploy as the code that stops using it. Prisma 8 has no down-migrations
and nothing here writes down-DDL.

Lost data comes back from PlanetScale's backups. A restore never happens in place: pick
a backup or a point in time (up to 5 minutes ago) under Backups and restore it to a **new
branch**, reset the role password there, then `dotenvx set` both URLs to the new branch's host
and redeploy. It reaches only as far back as the backup retention (2 days on the default
schedule), so check that window is wider than the gap between a bad migration landing and
someone noticing. https://planetscale.com/docs/postgres/backups/point-in-time-recovery

`GET /v1/health` answers 503 when `prisma_contract.marker` names an older contract in the
migration graph than the one this build was emitted against (`contractStorageHash`), so drift
shows up on the health check instead of as 500s. A database it cannot reach is reported as
`unknown` and stays healthy: a cold start is not drift.

## Vercel bundle

`bun run build` (`build.ts`) writes `.vercel/output`: `Bun.build` bundles
`src/vercel.ts` into one `index.js` (`target: 'bun'`, ESM), plus `config.json` routing everything to
the function and `.vc-config.json` (`runtime: bun1.x`, `launcherType: Nodejs`). The committed
`envs/.env.api.production.enc` is copied into the function; Vercel holds only
`DOTENV_PRIVATE_KEY_API_PRODUCTION`, and `DOTENVX_ENVS_DIR=.` in `.vc-config.json` makes
`vercel-tier-env.ts` decrypt it at boot (fatal if the file is missing or any value stays
`encrypted:`). The migration graph's contract hashes are inlined at build time as
`__ATLAS_MIGRATION_GRAPH__`, because the bundle has no `packages/db/migrations` directory to read.

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
from a `docker run --read-only` container of the same Bun image Vercel runs
(`BUN_IMAGE` in `test/bundle-container.ts`), with HOME on the read-only mount — the way Vercel's filesystem sees
it, so a package the bundle left out fails the spec instead of resolving from `node_modules`. A
host-side run cannot stand in for this: `bun --no-install` hides auto-install, and a read-only HOME
on macOS still finds a writable cache. It runs against a throwaway `postgres:17-alpine` container on
a spec-owned network and hits health, 401, bearer-authenticated, tRPC input validation, better-auth and the
HMAC webhook. Only the `api-bundle` CI job sets `ATLAS_LIVE_DOCKER=1` for it; elsewhere it is skipped. It
migrates the throwaway database the way `scripts/migrate-deploy.mjs` does (`db migrate --to db`).
Run it after adding any module or dependency: it catches an import the bundle misses.

Bun auto-installs any package it cannot resolve at import time, and on a read-only filesystem that
write kills the process instead of throwing a catchable resolve error. The function ships no
`bunfig.toml`: with a `node_modules` next to the bundle Bun does not auto-install, and the read-only
spec passes 8/8 without one, so the lazily imported externals fail as ordinary, caught resolve errors.

Work that must outlive the response goes to `BackgroundWork.keepAlive` (`src/_core/ports/background-work.ts`),
because a Vercel instance can freeze once the response is sent. `backgroundWorkProvider()` binds
`waitUntil` from `@vercel/functions` when `VERCEL === '1'` and a no-op otherwise. GitHub wake boots
ride it; web-thread provisioning runs in the `pod-provision` trigger.dev task instead. Both share
`VercelSandboxWakeBoot`, which mounts, launches serve and rolls back a sandbox it created when the
boot fails. A boot can outlive one
response: a sandbox create plus the serve download can approach the function's `maxDuration`.
`GithubSandboxWakeService` hands every tracked lookup and boot to `keepAlive`, and the
wake debounce is 0 on Vercel (the `wakeClaim` CAS dedupes events and instances), so the boot starts
inside the kept-alive lookup chain. The trigger.dev worker passes `ProcessBackgroundWork` and the
5 s debounce and relies on `settle()`.

The Vercel project `atlas-api` sits behind Comp AI's SSO on its `*.vercel.app` URLs, so smoke-test
those with the project's protection bypass header. `api.byatlas.io` is the production alias.

## Auth

better-auth is mounted through `@thallesp/nestjs-better-auth` in `src/api/platform/auth/auth.module.ts`,
with `bearer` and `deviceAuthorization` plugins. Middlewares and guards never import
better-auth: they depend on the `SESSION_VERIFIER` port (`src/_core/ports/session-verifier.ts`),
bound by `SessionModule.withVerifier(...)`. Every procedure is protected by
its router's `SessionMiddleware` or `SessionOrSandboxMiddleware`, and `meta({ public: true })` opts
one out. The remaining REST controllers carry no session guard: health is open and the webhooks
verify an HMAC. `ClientVersionGuard` and `ThrottlerGuard` stay global for those REST routes.

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
`repo read:org admin:repo_hook admin:ssh_signing_key workflow` (an `admin:X` grant satisfies `write:X` and `read:X`), instead of storing a token that can only ever see public repos. `workflow` is listed because sandboxes push with this token and GitHub rejects a push touching `.github/workflows/*` without it. `admin:ssh_signing_key` is listed because `DELETE /user/ssh_signing_keys/{id}` needs `admin:` and rotate/revoke of the commit-signing key deletes the old one; older connections keep working for everything else and get `github-signing-scope-missing` from `/v1/ssh-signing-key` until they reconnect.

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
`test/env-alignment.spec.ts`, which also fails on any tier line that is not a comment, a blank or an
`encrypted:` assignment (an unquoted multi-line value lands as bare lines that dotenvx never
encrypts). The repo pre-commit hook (`lefthook.yml`, installed by the root `postinstall`) runs
`dotenvx ext precommit` and `scripts/check-env-tiers.ts`. Add a variable in lockstep: the right `sections/*.ts` Joi rule +
interface field, then the key line in every tier file (commented with a recognized reason where
a tier does not supply it), then `dotenvx set` to fill values in place. Typed access is
`env.get('KEY')` via `EnvService`; never read `process.env` in app code (sanctioned exceptions:
`main.ts` bootstrap and `auth.server.ts`, which construct before Nest DI exists).

Local boot: `bun run db:up` (docker Postgres on 5433), `bun run db:migrate`, `bun run db:seed`,
`bun run dev`. An existing local database migrated by Prisma 7 first needs a one-off
`bun run env:inject -- bun run --cwd ../../packages/db prisma db sign 20261022T0209_baseline --no-advance-ref` (see `packages/db/AGENTS.md`).
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
- **Deploy is automatic.** The `deploy-trigger` job in `.github/workflows/release.yml` deploys to
  prod after `migrate-production` passes, on every merge to main that touches the API's build
  closure, serialized and never cancelled. The CLI authenticates with the `TRIGGER_ACCESS_TOKEN` repo secret (a `tr_pat_` personal token) and takes
  the project from `trigger.config.ts`. The job then decrypts the prod `TRIGGER_SECRET_KEY` and runs
  `scripts/trigger-smoke.ts`, which dispatches `atlas-smoke` (`SELECT 1` through the worker's db)
  and fails unless the run completes within two minutes. PRs get no deploy dry-run: `trigger deploy
  --dry-run` authenticates and fetches project env vars before it bundles, and PR code never
  receives the token. A manual deploy is `bun run trigger:deploy`.
- **Bundling:** `@dltech/atlas-wire` resolves through its `bun` export condition, so
  `trigger.config.ts` sets `conditions: ['bun']`. `@dltech/atlas-db`, `@prisma/orm-postgres`, `pg`
  and ioredis bundle; Prisma 8 has no query engine or wasm to keep external, and its
  `TimestamptzJsDate` columns need no `Temporal`, which Node 24 lacks. `bun run trigger:deploy -- --dry-run` proves the build but not the runtime;
  the smoke step is what proves the runtime. `src/vercel.ts` must never import `src/trigger/`.
- **Timers run only in local dev.** `GithubSweepSchedulerService` owns the 30 s and 60 s
  `@Interval`s and `ScheduleModule` is imported only when `VERCEL !== '1'`, so `bun run dev` keeps
  sweeping while Vercel instances never run timers. Prod sweeps are trigger.dev schedules.

## Rules that differ from the rest of the repo

- `bun:test` specs are colocated `*.spec.ts`. Specs that need data run against real Postgres through
  `useTestDatabase()` from `@dltech/atlas-db/testing` (a local lane on :55441, a service container in
  CI), never an in-memory fake. `db` is a lazy proxy, so importing it never connects.
- Everything else from the root CLAUDE.md still applies: 300-line files, no `as any`, no
  ts-ignore, E-prefixed enums, `handle`-prefixed handlers, named parameters, no comments that
  restate the code.
