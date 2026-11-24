# @dltech/atlas-db

Atlas Cloud's Postgres contract, migrations and runtime client, on Prisma 8. Server-side code only:
`apps/api`, the Trigger.dev worker, `packages/control`, `packages/github`, `packages/memory`,
`packages/pods` and `packages/previews` import it.

## Owns

- The Prisma contract under `src/prisma/schema/`, and the emitted `contract.json` and `contract.d.ts`.
- The migrations under `migrations/`, and the `db` ref that points at the graph tip.
- The runtime client: one shared `pg` pool and the `db` proxy over it.
- The test-database helpers and the dev seed.

## Does not own

- A query for a feature. `@dltech/atlas-control` and the API services own their own queries.
- Better-auth. It writes its own models through `sharedPool()`.
- The migrations of another service. Only this package owns a migration.

## Entry points

| Import                           | Use it for                                                         |
| -------------------------------- | ------------------------------------------------------------------ |
| `@dltech/atlas-db`               | The `db` client, the pool, the errors and the row and model types. |
| `@dltech/atlas-db/testing`       | `useTestDatabase` and the seed helpers for a spec.                 |
| `@dltech/atlas-db/testing/env`   | Sets `DATABASE_URL` to the run database in the test lane.          |
| `@dltech/atlas-db/migrations`    | `migrationGraphHashes()`, the hashes of the migration graph.       |
| `@dltech/atlas-db/contract.json` | The emitted contract as JSON data.                                 |

## Capabilities

### Query the database

- `db`: a lazy proxy over one shared pool. Importing the package does not connect. The first use
  of `db` reads `DATABASE_URL` and connects.
- `db.orm.public.<Model>`: the native ORM query. There is no Prisma 7 shim.
- `db.transaction(async (tx) => …)`: one transaction. A helper takes `tx: Tx`.
- `createDb(pool)`, `sharedPool()`, `closeSharedDb()`.
- `createPool(url, options?)`: the pool. The options are `queryTimeoutMs` and `minIdle`.
- `contract`, `contractStorageHash`, `Models`, `Row`, `Scalars`, `Shape`, `Db`, `Tx`.
- `and`, `not`, `or`: the query combinators.

### Read an error

- `isUniqueViolation(error)`: says if the error is the SQLSTATE 23505.
- `violatedConstraint(error)`: the constraint name of a unique violation.
- `databaseErrorCode(error)`, `isNoRows(error)`: the other checks.
- `retryOnConnectionLoss`, `isRetryableConnectionLoss`: retry a lost connection.

### Test against Postgres

- `useTestDatabase()`: registers `beforeAll` and `beforeEach`. It builds one template database per
  migration set, and it truncates every table before each test.
- `ensureTestDatabase()`, `truncateAll()`, `countQueries()`, `seedUser`, `seedThread`,
  `seedSession`.
- The lane is `ATLAS_TEST_DATABASE_URL`, default
  `postgresql://atlas:atlas@localhost:55441/atlas_test`.

## Usage

```sh
bun run contract:emit        # after a change under src/prisma/schema
bunx prisma migration plan --name <slug>
bun run db:test:up           # local test Postgres on :55441
bun run test
```

From `apps/api`, with the local tier env injected:

```sh
bun run db:up                # docker Postgres on :5433
bun run db:migrate           # prisma db migrate, advancing the db ref
bun run db:seed
```

From `apps/api/test/session-seed.ts`:

```ts
import { db, type Row } from '@dltech/atlas-db'
import { seedUser } from '@dltech/atlas-db/testing'

export async function seedUsers(...ids: string[]): Promise<void> {
  for (const id of ids) await seedUser({ db, id })
}
```

## Rules

- Import this package only in server-side code. It needs a database connection. `apps/api`, the
  Trigger.dev worker, `packages/control`, `packages/github`, `packages/memory`, `packages/pods`
  and `packages/previews` import it.
- Never make `db` eager. A build and a type-only import must run without a database.
- Run the specs against a real Postgres. Do not mock the client.
- Read a unique violation with `isUniqueViolation`. There is no P2002 code under Prisma 8.
- Pin `pg` 8.22.0 and `@types/pg` 8.20.4. Another version makes `createDb(pool)` fail to typecheck.

## See also

- [`packages/db/AGENTS.md`](AGENTS.md): the contract, migration and skill rules.
- `.agents/skills/prisma-8/SKILL.md`: the vendored Prisma 8 skill. Load it before a change to the
  contract or a migration.
