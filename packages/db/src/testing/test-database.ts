import pg from 'pg'
import { sharedPool } from '../client'
import { runDatabaseName, runPidOf } from './database-url'
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

async function databaseNames(client: pg.Client): Promise<string[]> {
  const found = await client.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE 'atlas_test_%'")
  return found.rows.map((row) => row.datname)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

async function createRunDatabase(): Promise<void> {
  const template = `atlas_test_tpl_${migrationSetHash()}`
  const name = runDatabaseName()
  await withLaneLock(async (client) => {
    const existing = await databaseNames(client)
    for (const stale of existing) {
      const pid = runPidOf(stale)
      if (pid !== undefined && pid !== process.pid && !processAlive(pid)) {
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(stale)} WITH (FORCE)`)
      }
    }
    if (!existing.includes(template)) await buildTemplate({ client, name: template })
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`)
  })
}

let ready: Promise<void> | undefined

export function ensureTestDatabase(): Promise<void> {
  const expected = databaseUrl({ lane: laneUrl(), name: runDatabaseName() })
  if (process.env.DATABASE_URL !== expected) {
    throw new Error('DATABASE_URL is not the run test database; preload @dltech/atlas-db/testing/env first')
  }
  ready ??= createRunDatabase()
  return ready
}

export async function truncateAll(): Promise<void> {
  const pool = sharedPool()
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
  const list = tables.rows.map((row) => `"public".${quoteIdent(row.tablename)}`).join(', ')
  if (list.length > 0) await pool.query(`TRUNCATE ${list} CASCADE`)
}
