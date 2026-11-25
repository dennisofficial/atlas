import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'
import { signDatabase } from '../testing/sign'

const ARCHIVE_MIGRATION = '20261125T0307_archive_v1_tables'
const DATABASE = `atlas_test_archive_${process.pid}`
const DB_ROOT = join(import.meta.dirname, '..', '..')

const ARCHIVED_TABLES = [
  'Session',
  'Thread',
  'Event',
  'Turn',
  'ThreadRead',
  'ContextFile',
  'SandboxBootStep',
  'CloudSandbox',
  'LocalPodLease',
  'PushDevice',
  'ComposerDraft',
  'OauthConnectionSandbox',
]

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

const seed = async (client: pg.Client) => {
  const statements: [string, unknown[]?][] = [
    [`INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('u', 'u', 'u@t.local', now())`],
    [`INSERT INTO "Project" (id, name, "ownerUserId", "updatedAt") VALUES ('p', 'p', 'u', now())`],
    [
      `INSERT INTO "Session" (id, "userId", "projectId", repo, title, "createdAt", "updatedAt")
       VALUES ('s1', 'u', 'p', 'o/r', 'title', now(), now())`,
    ],
    [
      `INSERT INTO "Thread" (id, "userId", "sessionId", "createdAt", "updatedAt")
       VALUES ('t1', 'u', 's1', now(), now())`,
    ],
    [
      `INSERT INTO "Event" (id, "threadId", seq, "runId", depth, at, type, body, "toolName", "userId")
       VALUES ('e1', 't1', 1, 'turn-1', 0, now(), 'tool-called', '{"name":"skill","input":{"name":"deploy"}}', 'skill', 'u')`,
    ],
    [
      `INSERT INTO "Turn" ("runId", "threadId", status, "providerId", "modelId", steps, "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "startedAt", "endedAt", "durationMs", "userId")
       VALUES ('turn-1', 't1', 'ok', 'anthropic', 'claude', 1, 10, 5, 0, 0, now(), now(), 1000, 'u')`,
    ],
    [
      `INSERT INTO "ThreadRead" ("userId", "threadId", seq, "updatedAt") VALUES ('u', 't1', 1, now())`,
    ],
    [
      `INSERT INTO "ContextFile" (id, "threadId", path, content, digest, "updatedAt")
       VALUES ('cf1', 't1', 'AGENTS.md', 'text', 'd1', now())`,
    ],
    [
      `INSERT INTO "SandboxBootStep" (id, "sessionId", step, state)
       VALUES ('b1', 's1', 'clone', 'ok')`,
    ],
    [
      `INSERT INTO "CloudSandbox" (id, "sessionId", "userId", "sandboxId", name, region, state, "lastActivityAt", "tokenHash", "createdAt", "updatedAt")
       VALUES ('c1', 's1', 'u', 'sbx-1', 'box', 'iad1', 'running', now(), 'hash', now(), now())`,
    ],
    [
      `INSERT INTO "LocalPodLease" (id, "userId", "threadId", "tokenHash", "updatedAt")
       VALUES ('l1', 'u', 't1', 'lease-hash', now())`,
    ],
    [
      `INSERT INTO "PushDevice" (id, token, platform, "lastSeenAt", "userId", "updatedAt")
       VALUES ('d1', 'expo-token', 'ios', now(), 'u', now())`,
    ],
    [
      `INSERT INTO "OauthConnection" (id, provider, "sealedTokens", "authorizationId", "userId", "updatedAt")
       VALUES ('conn1', 'anthropic', 'sealed', 'conn1', 'u', now())`,
    ],
    [
      `INSERT INTO "OauthConnectionSandbox" ("connectionId", "sandboxId")
       VALUES ('conn1', 'c1')`,
    ],
    [
      `INSERT INTO "ComposerDraft" ("userId", "scopeKey", "threadId", text, attachments, "updatedAt")
       VALUES ('u', 'scope', 't1', 'draft', '[]', now())`,
    ],
  ]
  for (const [sql, params] of statements) await client.query(sql, params)
}

const countsOf = async (client: pg.Client, schema: string, table: string): Promise<number> => {
  const found = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
  )
  return Number(found.rows[0]?.count ?? 0)
}

describe('the v1 table archive migration', () => {
  let client: pg.Client
  let seeded: { table: string; count: number }[]

  beforeAll(async () => {
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.query(`CREATE DATABASE ${quoteIdent(DATABASE)}`)
    await lane.end()
    client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: DATABASE }) })
    await client.connect()
    await applyMigrations(client, { stopBefore: ARCHIVE_MIGRATION })
    await seed(client)
    seeded = []
    for (const table of ARCHIVED_TABLES) {
      const count = await countsOf(client, 'public', table)
      expect(count).toBeGreaterThan(0)
      seeded.push({ table, count })
    }
    await applyMigration({ client, directory: ARCHIVE_MIGRATION })
  })

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  it('keeps every row in the v1_archive schema', async () => {
    for (const { table, count } of seeded) {
      expect({ table, count: await countsOf(client, 'v1_archive', table) }).toEqual({
        table,
        count,
      })
    }
  })

  it('leaves no archived table in public', async () => {
    const found = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [ARCHIVED_TABLES],
    )
    expect(found.rows).toEqual([])
  })

  it('keeps the foreign keys, including those into public', async () => {
    const found = await client.query<{ conname: string; source: string; target: string }>(
      `SELECT c.conname,
              sn.nspname || '.' || quote_ident(sc.relname) AS source,
              tn.nspname || '.' || quote_ident(tc.relname) AS target
         FROM pg_constraint c
         JOIN pg_class sc ON sc.oid = c.conrelid
         JOIN pg_namespace sn ON sn.oid = sc.relnamespace
         JOIN pg_class tc ON tc.oid = c.confrelid
         JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE c.contype = 'f' AND sn.nspname = 'v1_archive'
        ORDER BY c.conname`,
    )
    expect(found.rows).toHaveLength(22)
    expect(found.rows).toContainEqual({
      conname: 'ComposerDraft_threadId_fkey',
      source: 'v1_archive."ComposerDraft"',
      target: 'v1_archive."Thread"',
    })
    expect(found.rows).toContainEqual({
      conname: 'Session_userId_fkey',
      source: 'v1_archive."Session"',
      target: 'public."User"',
    })
    expect(found.rows).toContainEqual({
      conname: 'OauthConnectionSandbox_connectionId_fkey',
      source: 'v1_archive."OauthConnectionSandbox"',
      target: 'public."OauthConnection"',
    })
  })

  it('documents the schema, its tables and their columns', async () => {
    const schema = await client.query<{ obj_description: string | null }>(
      `SELECT obj_description('v1_archive'::regnamespace, 'pg_namespace') AS obj_description`,
    )
    expect(schema.rows[0]?.obj_description).toContain('frozen')

    const undocumented = await client.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'v1_archive'
          AND t.table_type = 'BASE TABLE'
          AND col_description(
                format('%I.%I', c.table_schema, c.table_name)::regclass,
                c.ordinal_position
              ) IS NULL`,
    )
    expect(undocumented.rows).toEqual([])
  })

  it('passes prisma db verify --strict', async () => {
    const url = databaseUrl({ lane: laneUrl(), name: DATABASE })
    signDatabase({ url })
    const verified = spawnSync('bunx', ['prisma', 'db', 'verify', '--strict'], {
      cwd: DB_ROOT,
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      encoding: 'utf8',
    })
    expect(verified.stderr).not.toContain('MIGRATION.')
    expect(verified.status).toBe(0)
  }, 180_000)
})
