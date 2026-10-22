# packages/db — Atlas's database on Prisma 8

`@dltech/atlas-db` owns the data contract, the migrations, the runtime client and the seed. Only
`apps/api` imports it. The repo root `CLAUDE.md` rules apply here too.

Load the vendored skill before you touch the contract, a migration or a query:
`.agents/skills/prisma-8/SKILL.md`. It is version-matched to the installed RC. Training data on
Prisma 8 is stale. After a Prisma bump, run `bunx prisma skills sync` and delete the
`.claude`/`.cursor`/`.devin` copies it also writes.

## The contract

- One model per file under `src/prisma/schema/<domain>/<model>.prisma`. Every file's first line is
  `// use prisma-8`; a file without it is silently skipped by `contract emit`.
- Domains: `auth`, `workspaces`, `projects`, `threads`, `sandboxes`, `provider-accounts`, `github`,
  `user-config`. Relations resolve across files.
- After any edit: `bun run contract:emit`. The emitted `src/prisma/schema/contract.{json,d.ts}` are
  committed; there is no generate step. CI fails when they are stale.
- Every timestamp is `TimestamptzJsDate(3)`: a JS `Date` in and out, ISO 8601 in JSON, and no
  `Temporal` needed, so the Node 24 trigger.dev worker runs it. `TimestamptzString` returns
  Postgres's own text (`2026-10-22 02:04:33.807+00`), which is not ISO and would change the API's
  wire format. `src/__tests__/timestamp-wire.spec.ts` fails if a timestamp column regresses.
- better-auth writes `User`, `Session`, `Account`, `Verification`, `Organization`, `Member`,
  `Invitation` and `DeviceCode` through the shared pool, so their model and field names must match
  its schema. The auth spec in `apps/api/src/api/platform/auth/` fails when they drift.
- An `upsert` target (`conflictOn`) must be the primary key or a `@@unique`. A unique *index*
  (`@@index(..., unique: true)`) does not qualify.
- Project ownership: exactly one of `ownerUserId` (personal) or `organizationId` (workspace), as a
  CHECK. `createdById` records who made it.
- The user-scope config models are `UserSecret`, `UserMcpServer` and `UserSetting`; `@@map` keeps
  their original table names.

## Migrations

Prisma 8 packages live under `migrations/app/<ts>_<slug>/` (`migration.ts`, `migration.json`,
`ops.json`), with content-addressed snapshots under `migrations/snapshots/` and the `db` ref at
`migrations/app/refs/db.json`.

- Plan: `bun run contract:emit && bunx prisma migration plan --name <slug>`. `migration plan`
  chains from the `db` ref, never from the newest directory on disk. Keep the ref at the graph tip
  (`bunx prisma migration ref set db <hash>` after planning), or pass `--from <tip hash>`.
- Never hand-edit `ops.json` or `migration.json`. Edit `migration.ts` (or a sibling module it
  imports, such as `data-steps.ts`), then self-emit with `bun migrations/app/<dir>/migration.ts`.
  `MIGRATION.HASH_MISMATCH` means you forgot.
- Never edit a migration that has reached a shared database. Plan a new one.
- The planner refuses to change an existing foreign key's `onDelete`/`onUpdate`
  (`MIGRATION.PLANNING_FAILED`, `foreignKeyConflict`). Write that change by hand with
  `bunx prisma migration new --name <slug> --from <hash>` as a drop and re-add of the constraint.
- A rename of a model or field needs `--rename Old:New` on the plan. Without it the planner drops
  and recreates, losing the rows.
- Data transforms (backfills, orphan cleanup, duplicate guards) are `rawSql` operations ordered
  before the DDL that needs them. A guard is a precheck that holds only when the data is clean, so
  a dirty database fails the whole migration with `MIGRATION.PRECHECK_FAILED` and nothing changes.
- On Postgres a `db migrate` run is one transaction.
- Never plan against, reset or `db update` a production database.

### Adopting an existing database

The Prisma 7 SQL history was not replayed. A database migrated by Prisma 7 adopts the contract
with `prisma db sign`, a one-off, human-gated step that writes only `prisma_contract.marker`.
The `_prisma_migrations` table left behind is inert. Sign the **baseline** contract, not the current
one: `bunx prisma db sign 20261022T0209_baseline --no-advance-ref`. A bare `db sign` signs the emitted
(latest) contract, which an old-history database does not satisfy, so it refuses and writes nothing.
`--no-advance-ref` keeps the committed `db` ref where it is. Then `bunx prisma db migrate` applies
every package past the baseline and `bunx prisma db verify --strict` exits 0. The baseline package
never runs on a signed database; `db migrate` starts at the marker.

### Deploy

`apps/api`'s PRE_DEPLOY job (`scripts/migrate-deploy.mjs`) runs `bun run --bun prisma db migrate`
from this directory, retried three times. The connection is `DIRECT_URL ?? DATABASE_URL`
(`prisma.config.ts`), because poolers break the migration lock. The Prisma 8 CLI wants Node
≥22.18 and the image ships 22.13, so it always runs under Bun. `GET /v1/health` compares
`contractStorageHash` with the marker and answers 503 while the database is behind.

## Runtime

- `db` is a lazy proxy over one shared `pg.Pool` (`sharedPool()`, built from `DATABASE_URL` on
  first use). Importing this package never connects, so builds and type-only imports need no
  database. Do not make it eager.
- Queries are the native ORM: `db.orm.public.<Model>`. There is no Prisma-7-shaped shim.
- `db.transaction(async (tx) => …)`; helpers take `tx: Tx`.
- Unique violations: `isUniqueViolation(error)` and `violatedConstraint(error)` (SQLSTATE 23505,
  constraint name on `cause.constraint`). There are no P2002/P2025 codes.
- better-auth takes `sharedPool()` directly; there is no Prisma adapter under Prisma 8.

## Seed and tests

- `bun run db:seed` (wrapped by `apps/api`'s `db:seed`, which injects the local tier env) upserts a
  dev user, a workspace with that user as a member, a personal project and a workspace project. It
  refuses any host other than localhost.
- Specs run against real Postgres, never a mocked client. `useTestDatabase()` from
  `@dltech/atlas-db/testing` builds one template database per migration set on a local lane
  (`ATLAS_TEST_DATABASE_URL`, default `postgresql://atlas:atlas@localhost:55441/atlas_test`), hands
  each spec file its own copy, and truncates before every test. Start the lane with
  `bun run db:test:up`. CI runs it as a service container.

## Version pins

- `prisma` 8.0.0-rc.24 (CLI) and `@prisma/orm-postgres` 8.0.0-rc.19 (runtime).
- Root `package.json` `overrides` pins `@prisma/orm-toolchain` and `@prisma/orm-framework` to
  8.0.0-rc.19. The rc.24 CLI depends on toolchain rc.18, which rejects rc.19's aggregate
  descriptors with `CONTRACT.AGGREGATE_DESCRIPTOR_INVALID` on every `contract print`/`emit`.
  Remove the override once the CLI depends on a toolchain that matches the runtime.
- `pg` 8.22.0 and `@types/pg` 8.20.4 match what `@prisma/orm-postgres` pins. Another version makes
  `createDb(pool)` fail to typecheck, because the two `Pool` types differ.
