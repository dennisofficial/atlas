# apps/api

The Atlas Cloud backend. NestJS 12 + better-auth + Prisma 8 (`@dltech/atlas-db`, `packages/db`) over PostgreSQL
(PlanetScale Postgres in deployed tiers, docker locally). First client is the Atlas TUI. Local account metadata,
API keys, ordinary secrets, user settings and MCP configuration stay on the machine. An explicit backup action
copies them to or from the API. Signing in transfers Atlas-native provider OAuth renewal to dedicated
cloud-owned connections. Local sessions and assigned sandboxes retrieve access tokens from that authority.
They never retrieve refresh tokens. Persistent ownership survives signout and outages. A stale local seed is
never a fallback refresher. Model requests still go directly to providers. Cloud MCP OAuth grants are personal
and the API holds them (`src/api/cloud/mcp-oauth`). The API brokers sign-in and refresh. Sandboxes receive
access tokens only. Local TUI sessions keep the loopback flow. Memory is never a synced domain.

Every Atlas-owned client calls the API through tRPC under `/v1/trpc` (`threads.create`,
`sandboxSelf.*`, `models.list` and the rest of the generated `AppRouter`). Only these routes stay REST: the
GitHub webhook controllers (`POST /v1/github/hooks/:repo`, `POST /v1/github/app/hook`,
`GET /v1/github/app/callback`), `GET /v1/health`, the agent's `GET /healthz`, `GET /mcp-oauth/callback`,
and better-auth's `/api/auth/*`.

**The API provisions Atlas Cloud sandboxes on the thread owner's own Vercel credentials.**
`threads.create` with a `firstMessage` writes the Thread, its first `user-said` Event and the
`CloudSandbox` claim in one transaction. It then dispatches the `pod-provision` trigger.dev task
(`src/api/cloud/sandbox-provisioning/`, worker `src/trigger/pod-provision/`). That task exits if its
`wakeClaim` was superseded. `threadSandbox.provision` is Retry. Without `firstMessage`
the procedure is unchanged for the TUI. A thread is API-provisioned when it has `SandboxBootStep`
rows. A web send or Retry never takes over a TUI BYO row, which has none. A TUI local pod registers
only its `LocalPodLease`. It never gets a `Thread` row, `Event` rows or a checkpoint row. The send and
Retry paths refuse a leased thread with 409.

**The sidebar lists sessions, not threads.** A `Session` owns its main thread and the sub-agent
threads spawned in it. It owns its pod (`CloudSandbox` and `SandboxBootStep` are keyed by `sessionId`).
It owns the per-session fields (project, repo, workspace, execution location, title, pin, archive).
Procedures still take a `threadId` and resolve its session. The resolvers are `sessionOfThread` and
`podSessionOf`, which walks a teammate's `managedBySessionId` to the session that owns the pod. Create
a session and its main thread with `createSessionWithMainThread`. `Session.mainThreadId` is nullable
because the two rows point at each other. `threads.live` streams the sidebar as a snapshot of flat
`LiveThreadRow`s plus the user's projects. It then upserts each row. A teammate row names its manager
through `managedBySessionId`. `threads.list` returns session main threads only. better-auth's table is
`AuthSession`.

A thread's owner is fixed at creation (`Thread.userId`). Sandboxes run only on the platform
account: `ScopedConfigService.vercelCredentials` reads `PLATFORM_VERCEL_TOKEN`,
`PLATFORM_VERCEL_TEAM_ID` and `PLATFORM_VERCEL_PROJECT_ID`, and answers 503 when one is missing.
Users never bring their own sandbox credential. **A sandbox keeps the Vercel project it was created
in** (`CloudSandbox.vercelProjectId`, written by both boot paths on a fresh create and read by
`platform/sandboxes/pod-project.ts`). Every later resume, renewal, stop, resize and delete targets
that project. Moving the platform credential to another project therefore moves only the sandboxes
created after it. Old sandboxes keep working until they are destroyed.
**Sandbox storage ends six hours after a session is archived.**
Archive parks the pod. `archived-sandbox-sweep` deletes the pod of a session archived past
`ARCHIVED_SANDBOX_GRACE_MS` (6 h), and `orphan-sandbox-sweep` soft-deletes the v2 session rows at the
same grace, measured from `archivedAt`. `orphan-sandbox-sweep` deletes stopped
sandboxes whose name no unarchived session resolves: a deleted session's pod, a dead v2 session's, a
probe's. A sandbox is addressed only by name, so a name that nothing resolves is unreachable storage.
The session rows stay for analytics. A
missing piece still creates the thread and the message. The API answers `not-configured` with the gap. The
API env `VERCEL_*` only inspect and stop TUI BYO rows. They never create a sandbox.

An API-provisioned sandbox carries **no** Vercel credentials (`injectVercelCredentials: false`).
Its serve sees `ATLAS_API_PROVISIONED=1` and uses its sandbox token on the `sandboxSelf` procedures:
`exposePort`, `stop`, `bootSteps` and `events`. `bootSteps` records Agent Running under the thread lock,
and that record must succeed before serve hydrates. `events` is write-behind and idempotent on
`(threadId, seq)`. Boot progress
lives in `SandboxBootStep`, which the web reads through `threadPod.status`. A message sent
while the pod is parked, absent or failed is appended as an Event and starts a pod. Serve hydrates
these Events at boot. `threadMessages.takeBack` takes back an unrun last message.

The TUI still provisions its own BYO sandboxes and registers them through `sandboxes.claim`. That path
is unchanged and frozen with the TUI. The API also provides identity, remote-control rendezvous,
thread discovery, backup sync and PR/CI webhooks.

**`models.list` (tRPC) serves each operator's model list.** `src/api/platform/models/` composes the catalogue from the
operator's accounts. When the operator holds an active OpenAI OAuth connection, the API replaces the static OpenAI list
with the live Codex list (`CodexModelsCatalogue`). The catalogue is cached per user in memory for 300 s and
revalidated with `If-None-Match`. A Codex failure returns the static list plus `liveError`. The code lives in
`@dltech/atlas-models`, and the provider sign-in helpers live in `@dltech/atlas-credentials/provider-oauth`. Session titles
come from `src/agent/naming`, which calls the quick model through the same provider stack as the agent host. The API
imports nothing of harness. `src/api/cloud/mcp-oauth` uses the agent's MCP OAuth helpers (`src/agent/mcp-oauth`)
through `src/agent/index.ts`, and the skills API reads built-ins and the catalogue from `@dltech/atlas-plugin-skills`.
`src/api/harness-boundary.spec.ts` and `architecture.spec.ts` enforce that rule.

## One app: `src/api` and `src/agent`

`main.ts` is the only entry. It hydrates the tier, validates env, asserts that the agent can boot, then
calls `createApp()` and `listen`. `create-app.ts` always mounts the root `AppModule` (`src/app.module.ts`):
`ApiModule` (`src/api/api.module.ts`), `AgentModule` (`src/agent/agent.module.ts`) and `HealthModule`.
It also mounts the drain hook that pauses held loops on shutdown. There is no host-free build and no flag: the
one service answers `api.byatlas.io` on one port.

`src/api` reaches the agent only through `src/agent/index.ts`. `src/agent` never imports `src/api`.
A boundary spec fails either direction.

## Runtime and tests

This package runs on **Bun** (`bun src/main.ts`, ESM, no build step) and tests with `bun test`.
Bun runs Nest's constructor `@Inject(...)` decorators under this package's tsconfig.
`test/bun-runtime.spec.ts` spawns the real app under `bun` and fails if a decorator is dropped.
`bunfig.toml`
preloads `nestjs-preload.ts` first. That preload settles `@nestjs/common` and `@nestjs/core` before the CJS
`@nestjs/throttler` requires them, which works around a Bun loader race that intermittently failed
specs with `require() async module ... is unsupported`. It then preloads the shared root `bun-test.setup.ts`
and `test.setup.ts` (env). `bunfig.toml` preloads apply only to `bun test`, not to `bun <file>` children,
so `test/fixtures/bun-di-probe.ts` imports `@nestjs/common` and `@nestjs/core` statically and the app graph
dynamically, like `main.ts` / `create-app.ts` do. Specs mock `../../../db`
with a synchronous `mock.module` factory over a statically imported fake. An `async` factory that
dynamic-imports the fake hangs the file under bun. Fake-timer helpers `advanceTimersByTimeAsync` and
`waitFor` live in `test/fake-timers.ts`. The other vitest-only helpers come from `@dltech/bun-test-shims`.

## Adding a route

Routes are nestjs-trpc routers, not controllers. The only controllers left are health, the
GitHub webhooks, and the agent's `/healthz` and `/mcp-oauth/callback`.
- Write a `@Router({ alias })` class in the feature module. List it as a provider. Every method is a
  `@Query`, `@Mutation` or `@Subscription` that declares both `input` and `output` as zod schemas
  from `@dltech/atlas-wire`. The generated file may import only `@trpc/server`, `zod` and wire.
  `packages/api-router/src/__tests__/generated-imports.spec.ts` fails a procedure without `output`.
  Input objects are `z.strictObject`.
- Authenticate with `@UseMiddlewares(SessionMiddleware)` (a user session) or
  `@UseMiddlewares(SessionOrSandboxMiddleware)` (a session, a sandbox token or a pod lease token).
  A procedure opts token kinds in with `meta({ podReachable: true, sandboxReachable: true })`. It
  tunes the throttle with `meta({ throttle: { limit, ttlMs } | false })`
  (`src/_module/trpc/procedure-meta.ts`). A sandbox token reaches any procedure whose
  input names a `threadId` in its own thread family. It also reaches a threadless procedure marked
  `sandboxReachable`. A pod token reaches only `podReachable` procedures. It never reaches a
  thread-family procedure. Mark a procedure `podReachable` only for a threadless, user-scoped
  capability that a local pod uses (decision 0015).
- The generated `AppRouter` (`packages/api-router/src/generated/server.ts`) is committed. The
  pre-commit hook regenerates it when api or wire sources are staged. The CI `check` job fails on
  drift. `nestjs-trpc watch` keeps it current in `bun run dev`. Commit what the hook writes.
- Clients import `AppRouter` types from `@dltech/atlas-api-router`. They never import them from `apps/api`. Web
  uses its `api` client, harness uses `createHarnessApiClient`, and everything else uses `createApiClient`.
- Test a router with `createMixedApp` (`src/api/platform/accounts/accounts.router.fixture.ts`) or
  the feature's `*.router.fixture.ts`. Use supertest against `/v1/trpc/<alias>.<procedure>`.
  Queries are GET with `?input=<json>`, mutations POST the input as the JSON body.

## Artifact storage

Publishing writes through `ArtifactBlobStore`
(`src/api/cloud/artifacts/artifact-blob-store.ts`). Its only implementation is
`S3ArtifactBlobStore`, against the Cloudflare R2 bucket `atlas-artifacts` (`ARTIFACT_S3_ENDPOINT`,
`ARTIFACT_S3_REGION`, `ARTIFACT_S3_BUCKET`, `ARTIFACT_S3_ACCESS_KEY_ID`,
`ARTIFACT_S3_SECRET_ACCESS_KEY`). A missing key answers 503 at use. `apps/artifacts-host` reads the
same bucket through its `ARTIFACTS` R2 binding. That binding is strongly consistent, so a publish is live
when it reports ready. Each version keeps its source under `artifacts/<id>/_source/v<N>/<path>`
and its served files under `artifacts/<id>/_route/v<N>/<path>`. `routes/<id>.json` names the live
version. Nothing builds on the server: `artifact_push` builds in the session's pod and uploads both
directory trees. `commitPublish` switches the live version under a per-artifact advisory lock. See
`docs/artifacts.md`.

## Layout

```
src/
  _core/      kernel: env module, decorators, ports, types. Imports nothing from slices.
  _lib/       infra adapters (crypto). Framework-light.
  _module/    shared injectable modules (session middleware + verifier port, tRPC middlewares).
  api/        the v1 app: api.module.ts + feature modules in two layers —
              platform/ (auth, accounts, sessions, sandboxes, health) and cloud/ (secrets,
              mcp-servers, user-context, github). One-way rule:
              cloud may import platform, platform never imports cloud;
              enforced by src/api/architecture.spec.ts.
  agent/      v2 sessions at runtime: claims them, wakes their sandboxes, drives the loop and
              publishes live frames. agent.module.ts is its Nest module, index.ts the only
              entry src/api may import.
  app.module.ts  the root — ApiModule + AgentModule + HealthModule + the drain hook.
  create-app.ts  composes the Nest app (CORS, parsers, pipes, filters) and inits it; never listens.
  main.ts     the only entry — hydrates env from the tier file when a DOTENV_PRIVATE_KEY
              is present, validates env, asserts the agent can boot, createApp(),
              graceful shutdown, listen.
.env.<tier>.enc  dotenvx tier files at the app root (committed; .env.keys, never).
test/         cross-cutting specs (env alignment).
```

Imports are plain relative paths. This package has no path aliases on purpose. tsc never
rewrites them, and every downstream toolchain (bundlers, tracers, containers) has broken on
them at least once. Relative imports work everywhere. Do not reintroduce them.

## Request bodies

The API stores no context archives. Context goes straight into the sandbox from the client, and
the old upload endpoints are gone. The global JSON body cap is 4 MB (`JSON_BODY_LIMIT` in
`src/_lib/body-limits.ts`) for every route. User-layer uploads fit because the harness skips files
over 3,000,000 bytes (`MAX_USER_LAYER_FILE_BYTES`). A file of 3,000,000 bytes has a base64 body of 4,000,000 bytes.

## Deploy

Production is the image-backed Render web service `atlas-api-image` (`srv-dbuu4tui0phs73ercifg`)
over PlanetScale `atlas/main`. Render builds nothing, because the workspace has no build minutes to spare.
`.github/workflows/release.yml` builds `apps/api/docker/Dockerfile` on every push to main. It pushes
the public `ghcr.io/dennisofficial/atlas-api:<sha>`, migrates, then deploys that image. Render's
auto-deploy is off. Background jobs run on trigger.dev. Nothing else hosts Atlas.
- Image: `oven/bun` with only `@dltech/atlas-api` and `@dltech/atlas-daemon` installed and the daemon
  bundle built. Start: `bun run --cwd apps/api start`. Render's health check is `/healthz`.
- Migrate: the `migrate` job runs `bun run --cwd apps/api db:migrate:predeploy` (three-try retry,
  then `prisma db verify --strict`). A failure stops the deploy. The previous instance keeps
  serving, so the schema never half-applies.
- Render env: `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`, `APP_TIER=production`, `BUN_VERSION`, `NODE_ENV`.

`api.byatlas.io` is a Render custom domain on the service, reached through an unproxied Cloudflare
CNAME to `atlas-api-image.onrender.com`. The MCP OAuth `redirect_uri` is
`https://api.byatlas.io/mcp-oauth/callback`.

`.github/workflows/release.yml` runs on every push to main. Its `render-live` job waits for the Render
deploy of `GITHUB_SHA` to go live, or to be superseded by a newer deploy. It then probes
`https://api.byatlas.io/healthz`. `deploy-trigger` (see Background jobs) needs that job, so trigger tasks
never run ahead of the migrated schema.

The migration is the only thing that applies schema in a deployed tier. The app never applies schema,
because it holds no DDL rights by design. The migration connects through
`DIRECT_URL` (PlanetScale's direct endpoint, :5432) when the tier supplies one. It falls back to
`DATABASE_URL` (`packages/db/prisma.config.ts`), which is its PgBouncer on :6432. A migration's session-level
lock does not survive
the pooler, and a killed job once left the lock pinned on a pooled backend so every later run timed
out acquiring it (P1002). `scripts/migrate-deploy.mjs` retries the deploy three times with a 20 s
backoff. The pre-deploy runs it before the verify step. The verify step sets `DATABASE_URL` to
`DIRECT_URL` for the same reason.

**Fix forward, never roll back.** A bad deploy is repaired by the next merge. A migration may therefore
drop or rename in the same deploy as the code that stops using it. Prisma 8 has no down-migrations,
and nothing here writes down-DDL.

Lost data comes back from PlanetScale's backups. A restore never happens in place. Pick
a backup or a point in time (up to 5 minutes ago) under Backups and restore it to a **new
branch**. Reset the role password there. Then run `dotenvx set` for both URLs to the new branch's host,
and redeploy. A restore reaches only as far back as the backup retention (2 days on the default
schedule), so check that the window is wider than the gap between a bad migration landing and
an operator noticing it. https://planetscale.com/docs/postgres/backups/point-in-time-recovery

`GET /v1/health` answers 503 when `prisma_contract.marker` names an older contract in the
migration graph than the one this build was emitted against (`contractStorageHash`). Drift then
shows up on the health check instead of as 500s. A database that the health check cannot reach is reported as
`unknown` and stays healthy. A cold start is not drift.

## Background work

Work that must outlive the request goes to `BackgroundWork.keepAlive`
(`src/_core/ports/background-work.ts`), bound to `ProcessBackgroundWork`. It tracks every promise and
waits for them at shutdown, capped at 5 s (`BACKGROUND_WORK_SHUTDOWN_CAP_MS`). GitHub wake boots run on
it: `GithubSandboxWakeService` hands every tracked lookup and boot to `keepAlive`, debounced by
`WAKE_DEBOUNCE_MS`. Web-thread provisioning
runs in the `pod-provision` trigger.dev task
instead. Both paths share `VercelSandboxWakeBoot`. It mounts, launches serve, and rolls back a
sandbox it created when the boot fails.

## Auth

better-auth is mounted through `@thallesp/nestjs-better-auth` in `src/api/platform/auth/auth.module.ts`,
with the `bearer` and `deviceAuthorization` plugins. Middlewares and guards never import
better-auth. They depend on the `SESSION_VERIFIER` port (`src/_core/ports/session-verifier.ts`),
bound by `SessionModule.withVerifier(...)`. Every procedure is protected by
its router's `SessionMiddleware` or `SessionOrSandboxMiddleware`. `meta({ public: true })` opts
one out. The remaining REST controllers carry no session guard: health is open and the webhooks
verify an HMAC. `ClientVersionGuard` and `ThrottlerGuard` stay global for those REST routes.

The device-authorization flow is how the TUI logs in. The pages live in `apps/web` (Vercel,
`byatlas.io`). The API only exposes the better-auth endpoints. `WEB_ORIGIN` is what points
the device `verificationUri` at the web app. The device page must claim the code
(`GET /api/auth/device?user_code=…`) while signed in, or approve and deny do not work.

## GitHub identity is an OAuth App; webhook transport may be a GitHub App

GitHub connect (user auth) uses the device flow against a plain **OAuth App** (`GITHUB_CLIENT_ID`).
That is per-user delegation. The API and sandboxes act with the user's own permissions, so nothing
is ever installed on a repo or org for auth. A GitHub App would invert that for auth. User tokens
become the intersection of user access, app permissions, and installation coverage, so a repo the app is not
installed on answers 404. The device flow ignores the requested scopes. User-to-server tokens
expire after 8 hours. `pollConnect` therefore refuses a grant whose `scope` is missing any of
`repo read:org admin:repo_hook admin:ssh_signing_key workflow`. An `admin:X` grant satisfies `write:X` and `read:X`.
The API refuses the grant rather than store a token that can only ever see public repos. `workflow` is listed because sandboxes push with this token, and GitHub rejects a push touching `.github/workflows/*` without it. `admin:ssh_signing_key` is listed because `DELETE /user/ssh_signing_keys/{id}` needs `admin:`, and rotate or revoke of the commit-signing key deletes the old one. Older connections keep working for everything else. They get `github-signing-scope-missing` from `/v1/ssh-signing-key` until they reconnect.

**Webhook transport is separate, and there a GitHub App is allowed.** A per-repo personal webhook
needs the subscribing user to be a repo admin. On an org repo where the user is not a repo admin, PR events
(`pull_request_review`, `pull_request_review_comment`, `issue_comment`) are degraded to polling, and
inline review comments never arrive. The Atlas GitHub App (`GITHUB_APP_SLUG`, owned by
`dennisofficial`) fixes that. Any org admin installs it once. GitHub then delivers the app's webhook to
`POST /v1/github/app/hook`, verified with `GITHUB_APP_WEBHOOK_SECRET`. The delivery routes to
subscribers exactly like a per-repo hook. Routing precedence per repo: app installation > personal
hook > poll-backed. User auth stays OAuth and never uses the app. The app also reads: a webhook's
REST fill of an App-covered repo uses the installation token (`GithubInstallationTokens`, minted
and cached per installation). Webhook handling therefore needs no user. Only a personal-hook repo borrows
the hook creator's or a subscriber's token. Only uncovered repos are polled.

## Env

House dotenvx conventions: each app keeps its encrypted per-tier files at its root as
`.env.<tier>.enc`. `.env.keys` and `.env.personal` are git-ignored. `test/env-alignment.spec.ts` enforces
key parity across tiers. It also fails on any tier line that is not a comment, a blank or an
`encrypted:` assignment, because an unquoted multi-line value lands as bare lines that dotenvx never
encrypts. The repo pre-commit hook (`lefthook.yml`, installed by the root `postinstall`) runs
`dotenvx ext precommit` and `scripts/check-env-tiers.ts`. Add a variable in lockstep. First add the right
`sections/*.ts` Joi rule and
interface field. Then add the key line in every tier file, commented with a recognized reason where
a tier does not supply it. Then run `dotenvx set` to fill values in place. Typed access is
`env.get('KEY')` via `EnvService`. Never read `process.env` in app code. Code that runs before Nest DI
exists builds one with `validatedEnvService()`. The sanctioned exceptions are `auth.server.ts`, which
constructs before Nest DI exists, and the tier loaders `src/api/hydrate-env.ts` and
`src/trigger/tier-env.ts`, which fill `process.env` before anything can validate it.

Local boot: `bun run db:up` (docker Postgres on 5433), `bun run db:migrate`, `bun run db:seed`,
`bun run dev`. An existing local database migrated by Prisma 7 first needs a one-off
`bun run env:inject -- bun run --cwd ../../packages/db prisma db sign 20261022T0209_baseline --no-advance-ref` (see `packages/db/AGENTS.md`).
Migrations run through `db:migrate`, which is dotenvx-injected. In production they run as the Render
pre-deploy command, `db:migrate:predeploy`. The app process never runs them.

## Redis

`src/_lib/redis` (`RedisService`, `RedisModule`) is the one Redis seam. Nothing else constructs an
ioredis client. `client()` is the shared, lazy command connection. A subscriber takes its own
connection from `duplicate()` and owns its teardown. A subscribed connection answers only pub/sub commands.
Postgres remains the durable source of truth. Redis carries notifications plus the
GitHub request coordinator (`GithubRequestCoordinator`): request-budget windows, refresh retry
cursors and repository-access proofs. One proof is kept per credential and repo. A grant is kept without expiry
until GitHub ends it. A denial is kept 30 seconds. A grant ends on a real signal from a call with that
user's own token. A 401 drops every grant of the credential. A repo 403/404 drops that repository's grant.
Redis eviction only costs one re-proof. It never deletes durable PR
state. There are no per-connection leases. `githubPrs.states` replays the cached states of the
user's subscribed and linked PRs and forwards fanout frames. It proves a linked repo's access once,
when it first sees that repo without a grant. A configured Redis outage parks budgeted GitHub work until it
recovers. Cached replay and live streams stay usable. Budget windows are kept per credential
fingerprint. `githubFetch` feeds GitHub's `x-ratelimit-*` headers back. Under 5% remaining, background
work (poll, hook and app sweeps) is refused until reset. Deliveries and foreground reads go on.
A secondary-limit 403 cools the credential down for `retry-after` or 60 s. The budget covers
access checks, subscription and hook setup, refreshes, webhook REST fills and the repository, branch and
tree pickers. A subscribe proves a user's access with the PR read it was already making. It never makes a
`/repos` call of its own. OAuth device flow and SSH signing-key management keep their own controls.
Local dev needs Redis: the app boots the agent in-process, and the agent refuses to start without
`REDIS_URL`. `isConfigured()` is `false` when `REDIS_URL` is unset, and callers choose local-only
behaviour there. `client()` and `duplicate()` throw rather than reach for localhost.

## Background jobs

trigger.dev is a required platform for this package, not an optional add-on. Tasks live under
`src/trigger/<feature>/`, and `trigger.config.ts` configures them (`dirs: ['./src/trigger']`, runtime
`node-24`, `maxDuration: 300`). The project is **Atlas** (`proj_yvwotwceptrneuuasamk`, org DL
Technologies LLC). The SDK, `@trigger.dev/build` and the `trigger.dev` CLI are pinned together at
one exact version. Bump all three at once.
- **One dispatch seam.** API code enqueues work through `JobDispatcher`
  (`src/_core/ports/job-dispatcher.ts`), bound globally by `TriggerModule`
  (`src/_lib/trigger/`). `dispatch({ task, payload, idempotencyKey, tags })` returns `{ runId }`.
  An SDK failure throws `JobDispatchError` carrying the task id. A payload the contract's schema rejects
  throws the same error. Nothing ever falls back to running the work in-process. `trigger-job-dispatcher.ts` is
  the only file in `src/api` or `src/_lib` that imports `@trigger.dev/sdk`. Nothing outside
  `src/trigger` imports worker code. `src/api/trigger-boundary.spec.ts` enforces both rules.
- **Contracts are owned by the caller.** A task's id, zod payload schema and
  `Task<id, payload, output>` type live in a contract file next to the feature that dispatches it.
  The file exports them as a `TaskContract`. The worker task `satisfies` that type, so the two stay in step
  without the API depending on the worker's graph. `src/trigger/smoke/smoke.contract.ts` is the
  exception: only CI dispatches `atlas-smoke`, so its contract sits beside the task.
- **`TRIGGER_SECRET_KEY` is required.** A missing key fails boot. Local uses the dev-environment
  key (`tr_dev_…`) and production uses the prod key. Specs and the CI image probe use a fixture.
- **Worker env is the tier.** `trigger-tier-extension.ts` ships `.env.production.enc` in
  the worker bundle. `src/trigger/init.ts` decrypts it into `process.env` before any task
  loads. `tier-env.ts` is fatal on a missing file or any value left `encrypted:`. The dashboard
  holds only `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`. Never paste an app secret into it.
- **Tasks build their service graph by hand**, outside Nest DI and once per run
  (`src/trigger/github/github-sweep-graph.ts`): plain constructor chains over an `EnvService` built
  from the validated `process.env`. The fan-out gets a `RedisPrFrameBus` when the tier carries
  `REDIS_URL`, else a `LocalPrFrameBus`. A worker only publishes, since it never calls `openStream`.
  Test a task by calling its run function directly with a stubbed graph or db
  (`pod-provision-graph.spec.ts`, `smoke.task.spec.ts`).
- **The GitHub sweeps run in apps/trigger.** `github-hook-sweep`, `github-poll-sweep` and
  `github-webhook-reconcile` read `@dltech/atlas-github` from the v2 project. This project keeps one
  task, `github-v1-wake-sweep`, over the trimmed graph: it refreshes `liveUntil` from v1 thread
  activity, retries failed v1 wakes, and drains the v1-only outbox kinds.
- **Local dev.** `bun run dev` runs the API and `trigger dev --profile atlas` together under one
  `env:inject`. When either exits, both stop. Dispatched runs execute only while that worker is up.
  `bun run dev:no-trigger` is the API alone, for work that dispatches nothing.
  `trigger:dev` runs only the worker.
- **Deploy is automatic.** The `deploy-trigger` job in `.github/workflows/release.yml` deploys to
  prod after `render-live` passes, on every merge to main that touches the API's build
  closure. It is serialized and never cancelled. The CLI authenticates with the `TRIGGER_ACCESS_TOKEN` repo secret (a `tr_pat_` personal token) and takes
  the project from `trigger.config.ts`. The job then decrypts the prod `TRIGGER_SECRET_KEY` and runs
  `scripts/trigger-smoke.ts`, which dispatches `atlas-smoke` (`SELECT 1` through the worker's db)
  and fails unless the run completes within two minutes. PRs get no deploy dry-run: `trigger deploy
  --dry-run` authenticates and fetches project env vars before it bundles, and PR code never
  receives the token. A manual deploy is `bun run trigger:deploy`.
- **Bundling:** `@dltech/atlas-wire` resolves through its `bun` export condition, so
  `trigger.config.ts` sets `conditions: ['bun']`. `@dltech/atlas-db`, `@prisma/orm-postgres`, `pg`
  and ioredis bundle. Prisma 8 has no query engine or wasm to keep external, and its
  `TimestamptzJsDate` columns need no `Temporal`, which Node 24 lacks. `bun run trigger:deploy -- --dry-run` proves the build but not the runtime.
  The smoke step is what proves the runtime.
- **Timers run only where asked.** `GithubSweepSchedulerService` owns the 30 s and 60 s
  `@Interval`s. `ScheduleModule` is imported only when `GITHUB_SWEEPS_IN_PROCESS=1`, which the
  `dev` script sets. `bun run dev` keeps sweeping, while the Render service and trigger.dev
  instances never run timers. Prod sweeps are trigger.dev schedules.

## Rules that differ from the rest of the repo

- `bun:test` specs are colocated `*.spec.ts`. Specs that need data run against real Postgres through
  `useTestDatabase()` from `@dltech/atlas-db/testing` (a local lane on :55441, a service container in
  CI). They never use an in-memory fake. `db` is a lazy proxy, so importing it never connects.
- Everything else from the root AGENTS.md still applies: 300-line files, no `as any`, no
  ts-ignore, E-prefixed enums, `handle`-prefixed handlers, named parameters, no comments that
  restate the code.
