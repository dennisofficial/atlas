import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createDb, type Db } from '../client'
import { createPool, type Pool } from '../pool'
import { databaseUrl, laneUrl, quoteIdent } from './lane'
import { applyMigrations, migrationSetHash } from './migrations'

const LANE_LOCK = 4_242_001

async function withLaneLock<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: laneUrl().toString() })
  try {
    await client.connect()
  } catch (error) {
    throw new Error(
      `no test Postgres at ${laneUrl().host}; start one with \`bun run --cwd packages/db db:test:up\``,
      { cause: error },
    )
  }
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LANE_LOCK])
    return await work(client)
  } finally {
    await client.end()
  }
}

async function databaseExists({ client, name }: { client: pg.Client; name: string }): Promise<boolean> {
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
  return found.rowCount === 1
}

async function buildTemplate({ client, name }: { client: pg.Client; name: string }): Promise<void> {
  const building = `${name}_build`
  await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(building)}`)
  await client.query(`CREATE DATABASE ${quoteIdent(building)}`)
  const target = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: building }) })
  await target.connect()
  try {
    await applyMigrations(target)
  } finally {
    await target.end()
  }
  await client.query(`ALTER DATABASE ${quoteIdent(building)} RENAME TO ${quoteIdent(name)}`)
  await client.query(`ALTER DATABASE ${quoteIdent(name)} IS_TEMPLATE true`)
}

export type TestDatabase = {
  url: string
  pool: Pool
  db: Db
  truncate: () => Promise<void>
  drop: () => Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const template = `atlas_test_tpl_${migrationSetHash()}`
  const name = `atlas_test_f${process.pid}_${randomBytes(4).toString('hex')}`
  await withLaneLock(async (client) => {
    if (!(await databaseExists({ client, name: template }))) await buildTemplate({ client, name: template })
    await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`)
  })
  const url = databaseUrl({ lane: laneUrl(), name })
  const pool = createPool(url)
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
  const tableList = tables.rows.map((row) => `"public".${quoteIdent(row.tablename)}`).join(', ')
  return {
    url,
    pool,
    db: createDb(pool),
    truncate: async () => {
      await pool.query(`TRUNCATE ${tableList} CASCADE`)
    },
    drop: async () => {
      await pool.end()
      await withLaneLock(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
      })
    },
  }
}
