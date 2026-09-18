# apps/api

The Atlas Cloud backend. NestJS 11 + better-auth + Prisma 7 (driver adapter) over PostgreSQL
(Neon in deployed tiers, docker locally). First client is the Atlas TUI; the first job is
credential centralization (see `.scratch/atlas-cloud/spec.md` while the effort is in flight).

## Runtime and tests — the exception

This package runs on **Node**, not Bun, and tests with **vitest**, not `bun test`. Nest's DI
requires legacy decorators with emitted metadata; Bun's transpiler drops them. vitest needs
`unplugin-swc` with `legacyDecorator` + `decoratorMetadata` for the same reason (see
`vitest.config.mts`). Everything else in the repo runs on Bun — keep this exception scoped to
this package.

## Layout

```
src/
  _core/      kernel: env module, decorators, ports, types. Imports nothing from slices.
  _lib/       infra adapters (crypto). Framework-light.
  _module/    shared injectable modules (session guard + verifier port).
  api/        the deployable app: app.module.ts + feature modules (auth, health, …).
  db/         the lazy `db` client proxy + generated-client type re-exports.
  main.ts     the entrypoint — boots the app, hydrating env from the tier file when a
              DOTENV_PRIVATE_KEY is present; also default-exports the handler (harmless).
  api/main.ts one-line shim so `nest start api` / `start:prod` boot the same bootstrap.
prisma/       schema + migrations only (the client wrapper moved to src/db).
envs/         dotenvx tier files (.env.api.<tier>.enc, committed; .env.keys, never).
test/         cross-cutting specs (env alignment).
```

Imports are plain relative paths — this package has no path aliases on purpose. tsc never
rewrites them, and every downstream toolchain (bundlers, tracers, containers) has broken on
them at least once; relative imports work everywhere. Do not reintroduce them.

## Deploy

DigitalOcean App Platform, git-connected to main: `apps/api/Dockerfile` (multi-stage, repo-root
build context) + `.do/app.yaml` (app spec: api service on port 3400 with a PRE_DEPLOY migrate
job, region nyc). The only env the platform needs is `APP_TIER`, `MIGRATE_TIER` and
`DOTENV_PRIVATE_KEY_API_PRODUCTION` — the tier file in the image carries the rest.

The Dockerfile's runtime stage copies explicit paths (`dist`, `envs`, `prisma`, `scripts`,
`prisma.config.ts`) — anything a package script loads by path must be added to that list or it
exists locally and 404s in the deploy. CI does not build this image, so a missing copy only
fails at deploy time.

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

The job connects through `DIRECT_URL` (Neon's non-pooled endpoint) when the tier supplies one,
falling back to `DATABASE_URL` — `prisma migrate deploy`'s session-level advisory lock does not
survive the pooler: a killed job once left the lock pinned on a pooled backend and every later
deploy timed out acquiring it (P1002). `scripts/migrate-deploy.mjs` also retries the deploy
three times with a 20s backoff, so two overlapping PRE_DEPLOY jobs no longer fail a deployment.

**Rollback does not unwind a migration.** App Platform can restore any of the last ten
successful deployments, and it restores code, configuration and the app spec — never database
data. It is control-panel only: Apps → the app → Activity → Rollback. `doctl apps` has no
rollback subcommand, and the deployment must share the app's region and database configuration. Prisma has no down-migrations either. So every migration must be backward-compatible with
the release it lands ahead of: add columns with defaults, add tables, never rename or drop in
the same deploy as the code that stops using them. A `FAILED_DEPLOY` job that ran down-DDL would
turn a failed deploy into data loss; there is deliberately none.

The database half of a rollback is Neon's, and it is already there — nothing to build. A restore
matches the timestamp to an LSN, moves the compute to a point-in-time branch so the connection
string does not change, and renames the pre-restore branch to `<name>_old_head_<timestamp>`, so
the restore is itself reversible:

```
neon branches restore main '^self@2026-09-16T04:00:00.000Z'
```

It only reaches as far back as the project's history retention — 1 day by default on paid plans,
6 hours on free, configurable to 7 days on Launch and 30 on Scale. Check that window is wider
than the gap between a bad migration landing and someone noticing, because outside it there is
no restore to make.

`GET /v1/health` answers 503 when the running build expects migrations the database has not
applied, so drift fails the health check and DO holds the previous release rather than serving
500s. A database it cannot reach is reported as `unknown` and stays healthy — a cold start is
not drift.

## Auth

better-auth is mounted through `@thallesp/nestjs-better-auth` in `src/api/auth/auth.module.ts`,
with `organization`, `bearer`, and `deviceAuthorization` plugins. Guards never import
better-auth: they depend on the `SESSION_VERIFIER` port (`src/_core/ports/session-verifier.ts`),
bound by `SessionModule.withVerifier(...)`. Feature routes opt into protection with
`@UseGuards(SessionAuthGuard)` and opt out with `@Public()`.

The device-authorization flow is how the TUI logs in. The pages live in `apps/web` (Vercel,
`byatlas.io`); the API only exposes the better-auth endpoints, and `WEB_ORIGIN` is what points
the device `verificationUri` at the web app. The device page must claim the code
(`GET /api/auth/device?user_code=…`) while signed in before approve/deny will work.

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

## Rules that differ from the rest of the repo

- vitest unit specs are colocated `*.spec.ts`; they never touch a real database (CI has none).
  `src/db`'s `db` is a lazy proxy, so importing it is safe; constructing queries is not.
- Everything else from the root CLAUDE.md still applies: 300-line files, no `as any`, no
  ts-ignore, E-prefixed enums, `handle`-prefixed handlers, named parameters, no comments that
  restate the code.
