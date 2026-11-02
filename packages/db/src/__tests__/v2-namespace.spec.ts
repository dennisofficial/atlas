import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigrations } from '../testing/migrations'

const MIGRATION = '20261102T0507_v2_record_core'
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations', 'app')
const V2_TABLES = ['V2Event', 'V2InboxEntry', 'V2Lease', 'V2Session', 'V2Thread']
const suffix = `${process.pid}_${Date.now()}`
const FULL = `atlas_test_v2ns_full_${suffix}`
const BEFORE = `atlas_test_v2ns_before_${suffix}`

type Step = { sql: string }

async function withLane<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: laneUrl().toString() })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function build({ name, stopBefore }: { name: string; stopBefore?: string }): Promise<void> {
  await withLane((client) => client.query(`CREATE DATABASE ${quoteIdent(name)}`))
  const client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name }) })
  await client.connect()
  try {
    await applyMigrations(client, stopBefore === undefined ? {} : { stopBefore })
  } finally {
    await client.end()
  }
}

async function snapshotOf({ name, schema }: { name: string; schema: string }) {
  const client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name }) })
  await client.connect()
  try {
    const columns = await client.query(
      `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1 ORDER BY 1, 3`,
      [schema],
    )
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = $1 ORDER BY 1, 2`,
      [schema],
    )
    const indexes = await client.query(
      'SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY 1, 2',
      [schema],
    )
    return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }
  } finally {
    await client.end()
  }
}

function opsStatements(directory: string): string[] {
  const operations: { execute: Step[] }[] = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, directory, 'ops.json'), 'utf8'),
  )
  return operations.flatMap((operation) => operation.execute.map((step) => step.sql))
}

describe('v2 namespace migration', () => {
  beforeAll(async () => {
    await build({ name: FULL })
    await build({ name: BEFORE, stopBefore: MIGRATION })
  }, 180_000)

  afterAll(async () => {
    await withLane(async (client) => {
      for (const name of [FULL, BEFORE]) {
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
      }
    })
  })

  it('creates schema v2 with the five tables and leaves public DDL identical', async () => {
    const full = await snapshotOf({ name: FULL, schema: 'v2' })
    const tables = [...new Set(full.columns.map((row) => row.table_name))]
    expect(tables).toEqual(V2_TABLES)
    expect(await snapshotOf({ name: BEFORE, schema: 'v2' })).toEqual({
      columns: [],
      constraints: [],
      indexes: [],
    })
    expect(await snapshotOf({ name: FULL, schema: 'public' })).toEqual(
      await snapshotOf({ name: BEFORE, schema: 'public' }),
    )
  })

  it('stores canonical and payload as text', async () => {
    const full = await snapshotOf({ name: FULL, schema: 'v2' })
    const typeOf = (table: string, column: string) =>
      full.columns.find((row) => row.table_name === table && row.column_name === column)?.data_type
    expect(typeOf('V2Event', 'canonical')).toBe('text')
    expect(typeOf('V2InboxEntry', 'payload')).toBe('text')
  })

  it('is the newest migration and confines every forward op to schema v2', () => {
    const directories = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'refs')
      .map((entry) => entry.name)
      .sort()
    expect(directories.at(-1)).toBe(MIGRATION)
    const statements = opsStatements(MIGRATION)
    expect(statements.length).toBeGreaterThan(0)
    for (const sql of statements) {
      expect(/^CREATE SCHEMA IF NOT EXISTS "v2"$/.test(sql) || sql.includes('"v2".')).toBe(true)
      expect(sql).not.toMatch(/"public"\./)
      expect(sql).not.toMatch(/\b(DROP|RENAME)\b/)
    }
  })
})
