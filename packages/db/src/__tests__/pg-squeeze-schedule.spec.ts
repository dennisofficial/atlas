import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration } from '../testing/migrations'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations', 'app')
const DIRECTORY = readdirSync(MIGRATIONS_DIR).find((entry) =>
  entry.endsWith('_pg_squeeze_github_webhook_inbox'),
)
const NAME = `atlas_test_squeeze_${process.pid}_${Date.now()}`

// The extension's own schema, minus the pg_squeeze domains: enough for squeeze.tables to accept the
// schedule the migration writes, so the registration is exercised where the library is not loaded.
const SQUEEZE_SCHEMA = `CREATE SCHEMA squeeze;
CREATE TYPE squeeze.schedule AS (
  minutes int[], hours int[], days_of_month int[], months int[], days_of_week int[]
);
CREATE TABLE squeeze.tables (
  id serial PRIMARY KEY,
  tabschema name NOT NULL,
  tabname name NOT NULL,
  UNIQUE (tabschema, tabname),
  schedule squeeze.schedule NOT NULL
)`

type Registration = { tabschema: string; tabname: string; minutes: number[]; hours: number[] }

function scheduled(directory: string | undefined): string {
  if (directory === undefined) throw new Error('the pg_squeeze migration is missing')
  return directory
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: NAME }) })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function migrate(client: pg.Client): Promise<void> {
  await applyMigration({ client, directory: scheduled(DIRECTORY) })
}

async function registrations(client: pg.Client): Promise<Registration[]> {
  const found = await client.query<Registration>(
    `SELECT tabschema, tabname, (schedule).minutes AS minutes, (schedule).hours AS hours
     FROM squeeze.tables ORDER BY tabschema, tabname`,
  )
  return found.rows
}

describe('the pg_squeeze migration', () => {
  beforeAll(async () => {
    const client = new pg.Client({ connectionString: laneUrl().toString() })
    await client.connect()
    try {
      await client.query(`CREATE DATABASE ${quoteIdent(NAME)}`)
    } finally {
      await client.end()
    }
  }, 60_000)

  afterAll(async () => {
    const client = new pg.Client({ connectionString: laneUrl().toString() })
    await client.connect()
    try {
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(NAME)} WITH (FORCE)`)
    } finally {
      await client.end()
    }
  })

  it('skips without error where the server has no pg_squeeze library', async () => {
    await withDatabase(async (client) => {
      await migrate(client)
      const found = await client.query<{ present: string | null }>(
        "SELECT to_regclass('squeeze.tables')::text AS present",
      )
      expect(found.rows.map((row) => row.present)).toEqual([null])
    })
  })

  it('registers the webhook inbox for a daily 09:30 UTC squeeze, once', async () => {
    await withDatabase(async (client) => {
      await client.query(SQUEEZE_SCHEMA)
      await migrate(client)
      await migrate(client)
      expect(await registrations(client)).toEqual([
        { tabschema: 'public', tabname: 'GithubWebhookInbox', minutes: [30], hours: [9] },
      ])
    })
  })
})
