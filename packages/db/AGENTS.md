# packages/db — Atlas's database on Prisma 8

`@dltech/atlas-db` owns the data contract, the migrations, the runtime client and the seed. Only
`apps/api` imports it. The repo root `AGENTS.md` rules apply here too.

Load the vendored skill before you touch the contract, a migration or a query:
`.agents/skills/prisma-8/SKILL.md`. The skill is version-matched to the installed RC, and training
data on Prisma 8 is stale. After a Prisma bump, run `bunx prisma skills sync`. Then delete the
`.claude`/`.cursor`/`.devin` copies it also writes.

## The contract

- One model per file under `src/prisma/schema/<domain>/<model>.prisma`. Every file's first line is
  `// use prisma-8`. `contract emit` silently skips a file without that line.
- Domains: `auth`, `projects`, `sessions`, `hosts`, `media`, `blobs`, `routines`, `changes`,
  `sandboxes`, `provider-accounts`, `github`, `user-config`, `artifacts`. Relations resolve across
  files. The v2 record tables live in `public` under plain names (`Session`, `Thread`, `Event`, …),
  with the `v2` schema kept only as a set of compatibility views for the deploy that moved them.
- After any edit, run `bun run contract:emit`. The emitted `src/prisma/schema/contract.{json,d.ts}`
  are committed. There is no generate step. CI fails when they are stale.
- Every timestamp is `TimestamptzJsDate(3)`: a JS `Date` in and out, and ISO 8601 in JSON. It needs
  no `Temporal`, so the Node 24 trigger.dev worker runs it. `TimestamptzString` returns Postgres's
  own text (`2026-10-22 02:04:33.807+00`). That text is not ISO and would change the API's wire
  format. `src/__tests__/timestamp-wire.spec.ts` fails if a timestamp column regresses.
- better-auth writes `User`, `AuthSession`, `Account`, `Verification` and `DeviceCode` through the
  shared pool, so their model and field names must match its schema. The auth spec in `apps/api/src/api/platform/auth/` fails when they drift.
- An `upsert` target (`conflictOn`) must be the primary key or a `@@unique`. A unique _index_
  (`@@index(..., unique: true)`) does not qualify.
- Project ownership: `ownerUserId` is required. `createdById` records who made it.
- The user-scope config models are `UserSecret` and `UserSetting`. `@@map` keeps their original
  table names. `McpServer` holds both user-scoped and project-scoped MCP servers, with `userId` XOR
  `projectId`. A cloud-registered server has `source = 'cloud'` and a sealed spec. A repo-defined
  server has `source = 'repo'` and the pod creates it. Each server's OAuth grant lives in its own
  row.

## Migrations

Prisma 8 packages live under `migrations/app/<ts>_<slug>/` (`migration.ts`, `migration.json`,
`ops.json`), with content-addressed snapshots under `migrations/snapshots/` and the `db` ref at
`migrations/app/refs/db.json`.
- Plan a migration with `bun run contract:emit && bunx prisma migration plan --name <slug>`.
  `migration plan` chains from the `db` ref, not from the newest directory on disk. After planning,
  keep the ref at the graph tip with `bunx prisma migration ref set db <hash>`. Otherwise pass
  `--from <tip hash>`.
- Never hand-edit `ops.json` or `migration.json`. Edit `migration.ts`, or a sibling module it
  imports such as `data-steps.ts`. Then self-emit with `bun migrations/app/<dir>/migration.ts`.
  `MIGRATION.HASH_MISMATCH` means you forgot the self-emit.
- Never edit a migration that has reached a shared database. Plan a new one.
- The planner refuses to change an existing foreign key's `onDelete`/`onUpdate`
  (`MIGRATION.PLANNING_FAILED`, `foreignKeyConflict`). Write that change by hand with
  `bunx prisma migration new --name <slug> --from <hash>`. Drop the constraint and add it again.
- A rename of a model or field needs `--rename Old:New` on the plan. Without it the planner drops
  and recreates the object, and the rows are lost.
- Data transforms are `rawSql` operations: backfills, orphan cleanup and duplicate guards. Order
  each one before the DDL that needs it. A guard is a precheck that holds only when the data is
  clean. A dirty database fails the whole migration with `MIGRATION.PRECHECK_FAILED`, and nothing
  changes.
- On Postgres a `db migrate` run is one transaction.
- A data-only migration has the same `from` and `to` hash. A bare `db migrate` treats that edge as
  already applied. Give its `rawSql` an `invariantId`. Add that id to `refs/db.json`'s
  `invariants`. Migrate with `--to db`, which every script here does, so the run takes the edge.
- Never plan against, reset or `db update` a production database.

### Adopting an existing database

The Prisma 7 SQL history was not replayed. A database migrated by Prisma 7 adopts the contract
with `prisma db sign`, a one-off step that requires the operator's approval. That step writes only
`prisma_contract.marker`. The `_prisma_migrations` table left behind is inert. Sign the
**baseline** contract, not the current one: `bunx prisma db sign 20261022T0209_baseline --no-advance-ref`. A bare
`db sign` signs the emitted (latest) contract. An old-history database does not satisfy that
contract, so the command refuses and writes nothing.
`--no-advance-ref` keeps the committed `db` ref where it is. Then `bunx prisma db migrate` applies
every package past the baseline, and `bunx prisma db verify --strict` exits 0. The baseline package
never runs on a signed database. `db migrate` starts at the marker.

### Deploy

The `migrate-production` job in `.github/workflows/release.yml` runs
`bun run --bun prisma db migrate --to db` from this directory, through `apps/api`'s
`scripts/migrate-deploy.mjs`. The job retries three times. The connection is `DIRECT_URL ?? DATABASE_URL`
(`prisma.config.ts`), because poolers break the migration lock. The Prisma 8 CLI wants Node
≥22.18 and `.nvmrc` pins 22.13, so the job always runs under Bun. `GET /v1/health` compares
`contractStorageHash` with the marker, and answers 503 while the database is behind.

## Runtime

- `db` is a lazy proxy over one shared `pg.Pool` (`sharedPool()`, built from `DATABASE_URL` on
  first use). Importing this package never connects, so builds and type-only imports need no
  database. Do not make it eager.
- Queries are the native ORM: `db.orm.public.<Model>`. There is no Prisma-7-shaped shim.
- Use `db.transaction(async (tx) => …)`. Helpers take `tx: Tx`.
- Read a unique violation with `isUniqueViolation(error)` and `violatedConstraint(error)`. The
  SQLSTATE is 23505, and the constraint name is on `cause.constraint`. There are no P2002/P2025
  codes.
- better-auth takes `sharedPool()` directly. There is no Prisma adapter under Prisma 8.

## Seed and tests

- `bun run db:seed` upserts a dev user and a personal project. `apps/api`'s `db:seed` wraps it and
  injects the local tier env. The seed refuses any host other than localhost.
- Specs run against real Postgres, never a mocked client. `useTestDatabase()` from
  `@dltech/atlas-db/testing` builds one template database per migration set on a local lane. The
  lane is `ATLAS_TEST_DATABASE_URL`, default
  `postgresql://atlas:atlas@localhost:55441/atlas_test`. Each spec file gets its own copy, and the
  database is truncated before every test. Start the lane with `bun run db:test:up`. CI runs it as a
  service container.

## The v1 archive

The twelve v1 tables (`Session`, `Thread`, `Event`, `Turn`, `ThreadRead`, `ContextFile`,
`SandboxBootStep`, `CloudSandbox`, `LocalPodLease`, `PushDevice`, `ComposerDraft`,
`OauthConnectionSandbox`) sit in the `v1_archive` schema: out of the contract, frozen, and readable
by SQL only. `docs/data/v1-archive.md` documents their columns and the analytics queries that read
them. Do not declare the schema in the contract, and do not move the tables back to `public`.

## Version pins

- `prisma` 8.0.0-rc.24 (CLI) and `@prisma/orm-postgres` 8.0.0-rc.19 (runtime).
- Root `package.json` `overrides` pins `@prisma/orm-toolchain` and `@prisma/orm-framework` to
  8.0.0-rc.19. The rc.24 CLI depends on toolchain rc.18, which rejects rc.19's aggregate
  descriptors with `CONTRACT.AGGREGATE_DESCRIPTOR_INVALID` on every `contract print`/`emit`.
  Remove the override once the CLI depends on a toolchain that matches the runtime.
- `pg` 8.22.0 and `@types/pg` 8.20.4 match what `@prisma/orm-postgres` pins. Another version makes
  `createDb(pool)` fail to typecheck, because the two `Pool` types differ.
