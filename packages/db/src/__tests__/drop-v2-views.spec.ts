import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'
import { signDatabase } from '../testing/sign'

const MIGRATION = '20261125T0506_drop_v2_compat_views'
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations', 'app')
const LATER_MIGRATIONS = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'refs')
  .map((entry) => entry.name)
  .sort()
  .filter((name) => name > MIGRATION)
const DATABASE = `atlas_test_drop_v2_views_${process.pid}`
const NEGATIVE = `atlas_test_drop_v2_views_negative_${process.pid}`
const DB_ROOT = join(import.meta.dirname, '..', '..')

const VIEWS = [
  ['V2Blob', 'Blob'],
  ['V2BlobRef', 'BlobRef'],
  ['V2ChangeBlob', 'ChangeBlob'],
  ['V2ComposerDraft', 'SessionDraft'],
  ['V2ContextFile', 'ContextFile'],
  ['V2DiagramRepair', 'DiagramRepair'],
  ['V2Event', 'Event'],
  ['V2Host', 'Host'],
  ['V2InboxEntry', 'InboxEntry'],
  ['V2Lease', 'Lease'],
  ['Media', 'Media'],
  ['MediaSigningWindow', 'MediaSigningWindow'],
  ['V2PushDevice', 'PushDevice'],
  ['V2Routine', 'Routine'],
  ['V2RoutineRun', 'RoutineRun'],
  ['V2SandboxRun', 'SandboxRun'],
  ['V2Session', 'Session'],
  ['V2SessionBranch', 'SessionBranch'],
  ['V2SessionPullRequest', 'SessionPullRequest'],
  ['V2SessionView', 'SessionView'],
  ['V2Terminal', 'Terminal'],
  ['V2Thread', 'Thread'],
  ['V2WorktreeChangedFile', 'WorktreeChangedFile'],
  ['V2WorktreeChanges', 'WorktreeChanges'],
] as const

const SEEDS = [
  `INSERT INTO "v2"."V2Session" (id, "userId", "mainThreadId", "nextInboxId", "createdAt", "modelRef", "modelEffort", "modelFast")
   VALUES ('ses_1', 'u', 'thr_1', 1, now(), 'anthropic/claude', 'medium', false)`,
  `INSERT INTO "v2"."V2Thread" (id, "sessionId", "headSeq", "headHash", visibility, "createdAt")
   VALUES ('thr_1', 'ses_1', 1, 'genesis', '{"spans":[]}', now())`,
  `INSERT INTO "v2"."V2Event" ("threadId", seq, id, epoch, type, "runId", at, "prevHash", hash, canonical)
   VALUES ('thr_1', 1, 'evt_1', 1, 'message', 'run_1', now(), 'genesis', 'h1', '{}')`,
  `INSERT INTO "v2"."V2InboxEntry" ("sessionId", "inboxId", kind, payload, "postedAt")
   VALUES ('ses_1', 1, 'user', '{}', now()), ('ses_1', 2, 'user', '{}', now())`,
  `INSERT INTO "v2"."V2Lease" ("sessionId", epoch, "holderHostId", "wantsHolder", attempts)
   VALUES ('ses_1', 1, NULL, false, 0)`,
  `INSERT INTO "v2"."V2Host" (label, "startedAt") VALUES ('drop-host', now())`,
  `INSERT INTO "v2"."V2SandboxRun" (id, "sessionId", "userId", provider, vcpus, "memoryGb", "diskGb", "startedAt")
   VALUES ('run_1', 'ses_1', 'u', 'vercel', 2, 4, 8, now())`,
  `INSERT INTO "v2"."V2Terminal" ("sessionId", "terminalId", ordinal, name, state, "createdAt")
   VALUES ('ses_1', 'term_1', 1, 'shell', 'open', now())`,
  `INSERT INTO "v2"."V2Routine" (id, "userId", "projectId", name, prompt, cron, timezone, "nextRunAt", "createdAt", "updatedAt")
   VALUES ('rt_1', 'u', 'p', 'nightly', 'p', '0 0 * * *', 'UTC', now(), now(), now())`,
  `INSERT INTO "v2"."V2RoutineRun" (id, "routineId", "scheduledFor", outcome, at)
   VALUES ('rr_1', 'rt_1', now(), 'ok', now())`,
  `INSERT INTO "v2"."V2PushDevice" (id, "userId", kind, token, "clientId", label, "lastSeenAt", "createdAt")
   VALUES ('dev_1', 'u', 'ios', 'expo-token', 'client', 'phone', now(), now())`,
  `INSERT INTO "v2"."V2ComposerDraft" ("userId", "scopeKey", "sessionId", text, attachments, "updatedAt")
   VALUES ('u', 'scope', 'ses_1', 'draft', '[]', now())`,
  `INSERT INTO "v2"."V2ContextFile" (id, "sessionId", path, digest, size, mime, kind, "mtimeMs", "updatedAt")
   VALUES ('cf_1', 'ses_1', 'AGENTS.md', 'digest', 4, 'text/plain', 'file', 1.5, now())`,
  `INSERT INTO "v2"."V2DiagramRepair" ("sessionId", "sourceHash", source, "modelRef")
   VALUES ('ses_1', 'sha', 'graph TD', 'anthropic/claude')`,
  `INSERT INTO "v2"."Media" ("userId", hash, "mediaType", size, width, height)
   VALUES ('u', 'media-hash', 'image/png', 10, 4, 4)`,
  `INSERT INTO "v2"."MediaSigningWindow" ("windowStart", "validUntil", sealed)
   VALUES (date_trunc('hour', now()), now() + interval '1 hour', 'sealed')`,
  `INSERT INTO "v2"."V2Blob" (hash, bytes, size, "createdAt") VALUES ('blob-hash', '\\x00'::bytea, 1, now())`,
  `INSERT INTO "v2"."V2BlobRef" ("sessionId", hash) VALUES ('ses_1', 'blob-hash')`,
  `INSERT INTO "v2"."V2ChangeBlob" (hash, size, "createdAt") VALUES ('change-hash', 1, now())`,
  `INSERT INTO "v2"."V2WorktreeChanges" (id, "sessionId", repo, "worktreePath", fingerprint, "updatedAt")
   VALUES ('wt_1', 'ses_1', 'o/r', '/tmp/wt', 'fp', now())`,
  `INSERT INTO "v2"."V2WorktreeChangedFile" ("checkoutId", path, status, additions, deletions, "binary")
   VALUES ('wt_1', 'src/a.ts', 'modified', 1, 2, false)`,
  `INSERT INTO "v2"."V2SessionBranch" ("sessionId", "headRepo", branch, "firstSeenSeq")
   VALUES ('ses_1', 'o/r', 'atlas/work', 1)`,
  `INSERT INTO "v2"."V2SessionPullRequest" ("sessionId", "repoFullName", "prNumber")
   VALUES ('ses_1', 'o/r', 12)`,
  `INSERT INTO "v2"."V2SessionView" ("sessionId", "threadId", "atSeq", version, state, "updatedAt")
   VALUES ('ses_1', 'thr_1', 1, 1, '{}', now())`,
]

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

const relkindOf = async (client: pg.Client, relation: string): Promise<string | undefined> => {
  const found = await client.query<{ relkind: string | null }>(
    'SELECT relkind FROM pg_class WHERE oid = to_regclass($1)',
    [relation],
  )
  return found.rows[0]?.relkind ?? undefined
}

const countsOf = async (client: pg.Client, schema: string, table: string): Promise<number> => {
  const found = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
  )
  return Number(found.rows[0]?.count ?? 0)
}

const relationsInV2 = async (client: pg.Client): Promise<number> => {
  const found = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'v2'`,
  )
  return Number(found.rows[0]?.count ?? 0)
}

async function buildDatabase(name: string): Promise<pg.Client> {
  const lane = admin()
  await lane.connect()
  await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
  await lane.query(`CREATE DATABASE ${quoteIdent(name)}`)
  await lane.end()
  const client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name }) })
  await client.connect()
  await applyMigrations(client, { stopBefore: MIGRATION })
  return client
}

async function dropDatabase(name: string): Promise<void> {
  const lane = admin()
  await lane.connect()
  await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
  await lane.end()
}

describe('the v2 compatibility view drop', () => {
  let client: pg.Client
  let seeded: { table: string; count: number }[]

  beforeAll(async () => {
    client = await buildDatabase(DATABASE)
    for (const statement of SEEDS) await client.query(statement)
    seeded = []
    for (const [, table] of VIEWS) {
      seeded.push({ table, count: await countsOf(client, 'public', table) })
    }
    expect(seeded.every((entry) => entry.count > 0)).toBe(true)
    for (const [view] of VIEWS) expect(await relkindOf(client, `v2."${view}"`)).toBe('v')
    await applyMigration({ client, directory: MIGRATION })
  }, 180_000)

  afterAll(async () => {
    await client.end()
    await dropDatabase(DATABASE)
  })

  it('drops every compatibility view and the v2 schema', async () => {
    for (const [view] of VIEWS) {
      expect({ relation: `v2.${view}`, kind: await relkindOf(client, `v2."${view}"`) }).toEqual({
        relation: `v2.${view}`,
        kind: undefined,
      })
    }
    const namespace = await client.query<{ v2: string | null }>(
      `SELECT to_regnamespace('v2')::text AS v2`,
    )
    expect(namespace.rows).toEqual([{ v2: null }])
    expect(await relationsInV2(client)).toBe(0)
  })

  it('keeps every public table and every row', async () => {
    for (const { table, count } of seeded) {
      expect({ table, kind: await relkindOf(client, `public."${table}"`) }).toEqual({
        table,
        kind: 'r',
      })
      expect({ table, count: await countsOf(client, 'public', table) }).toEqual({ table, count })
    }
  })

  it('passes prisma db verify --strict', async () => {
    for (const directory of LATER_MIGRATIONS) await applyMigration({ client, directory })
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

describe('the v2 compatibility view drop refusals', () => {
  let client: pg.Client

  beforeAll(async () => {
    client = await buildDatabase(NEGATIVE)
  }, 180_000)

  afterAll(async () => {
    await client.end()
    await dropDatabase(NEGATIVE)
  })

  it('refuses a base table where a view should be, and changes nothing', async () => {
    await client.query('DROP VIEW v2."V2Host"')
    await client.query('CREATE TABLE v2."V2Host" (id integer)')

    await client.query('BEGIN')
    await expect(applyMigration({ client, directory: MIGRATION })).rejects.toThrow(
      /refusing to drop v2.V2Host/,
    )
    await client.query('ROLLBACK')

    expect(await relkindOf(client, 'v2."V2Host"')).toBe('r')
    expect(await relkindOf(client, 'v2."V2Blob"')).toBe('v')
    expect(await relkindOf(client, 'v2."V2Session"')).toBe('v')
  }, 120_000)

  it('refuses to drop the schema while an unknown relation remains', async () => {
    await client.query('DROP TABLE v2."V2Host"')
    await client.query('CREATE VIEW v2."V2Host" AS SELECT * FROM public."Host"')
    await client.query('CREATE TABLE v2."Leftover" (id integer)')

    await client.query('BEGIN')
    await expect(applyMigration({ client, directory: MIGRATION })).rejects.toThrow(
      /refusing to drop schema v2: relations remain: v2.Leftover/,
    )
    await client.query('ROLLBACK')

    expect(await relkindOf(client, 'v2."Leftover"')).toBe('r')
    expect(await relkindOf(client, 'v2."V2Blob"')).toBe('v')
    expect(await relkindOf(client, 'v2."V2Session"')).toBe('v')
  }, 120_000)
})
