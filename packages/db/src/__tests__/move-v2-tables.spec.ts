import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'
import { signDatabase } from '../testing/sign'

const MIGRATION = '20261125T0351_move_v2_tables_to_public'
const DATABASE = `atlas_test_move_v2_${process.pid}`
const DB_ROOT = join(import.meta.dirname, '..', '..')

const MOVED_TABLES = [
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
  `INSERT INTO "public"."Session" (id, "userId", "mainThreadId", "nextInboxId", "createdAt", "modelRef", "modelEffort", "modelFast")
   VALUES ('ses_1', 'u', 'thr_1', 1, now(), 'anthropic/claude', 'medium', false)`,
  `INSERT INTO "public"."Thread" (id, "sessionId", "headSeq", "headHash", visibility, "createdAt")
   VALUES ('thr_1', 'ses_1', 1, 'genesis', '{"spans":[]}', now())`,
  `INSERT INTO "public"."Event" ("threadId", seq, id, epoch, type, "runId", at, "prevHash", hash, canonical)
   VALUES ('thr_1', 1, 'evt_1', 1, 'message', 'run_1', now(), 'genesis', 'h1', '{}')`,
  `INSERT INTO "public"."InboxEntry" ("sessionId", "inboxId", kind, payload, "postedAt")
   VALUES ('ses_1', 1, 'user', '{}', now()), ('ses_1', 2, 'user', '{}', now())`,
  `INSERT INTO "public"."Lease" ("sessionId", epoch, "holderHostId", "wantsHolder", attempts)
   VALUES ('ses_1', 1, NULL, false, 0)`,
  `INSERT INTO "public"."Host" (label, "startedAt") VALUES ('sweep-host', now())`,
  `INSERT INTO "public"."SandboxRun" (id, "sessionId", "userId", provider, vcpus, "memoryGb", "diskGb", "startedAt")
   VALUES ('run_1', 'ses_1', 'u', 'vercel', 2, 4, 8, now())`,
  `INSERT INTO "public"."Terminal" ("sessionId", "terminalId", ordinal, name, state, "createdAt")
   VALUES ('ses_1', 'term_1', 1, 'shell', 'open', now())`,
  `INSERT INTO "public"."Routine" (id, "userId", "projectId", name, prompt, cron, timezone, "nextRunAt", "createdAt", "updatedAt")
   VALUES ('rt_1', 'u', 'p', 'nightly', 'p', '0 0 * * *', 'UTC', now(), now(), now())`,
  `INSERT INTO "public"."RoutineRun" (id, "routineId", "scheduledFor", outcome, at)
   VALUES ('rr_1', 'rt_1', now(), 'ok', now())`,
  `INSERT INTO "public"."PushDevice" (id, "userId", kind, token, "clientId", label, "lastSeenAt", "createdAt")
   VALUES ('dev_1', 'u', 'ios', 'expo-token', 'client', 'phone', now(), now())`,
  `INSERT INTO "public"."SessionDraft" ("userId", "scopeKey", "sessionId", text, attachments, "updatedAt")
   VALUES ('u', 'scope', 'ses_1', 'draft', '[]', now())`,
  `INSERT INTO "public"."ContextFile" (id, "sessionId", path, digest, size, mime, kind, "mtimeMs", "updatedAt")
   VALUES ('cf_1', 'ses_1', 'AGENTS.md', 'digest', 4, 'text/plain', 'file', 1.5, now())`,
  `INSERT INTO "public"."DiagramRepair" ("sessionId", "sourceHash", source, "modelRef")
   VALUES ('ses_1', 'sha', 'graph TD', 'anthropic/claude')`,
  `INSERT INTO "public"."Media" ("userId", hash, "mediaType", size, width, height)
   VALUES ('u', 'media-hash', 'image/png', 10, 4, 4)`,
  `INSERT INTO "public"."MediaSigningWindow" ("windowStart", "validUntil", sealed)
   VALUES (date_trunc('hour', now()), now() + interval '1 hour', 'sealed')`,
  `INSERT INTO "public"."Blob" (hash, bytes, size, "createdAt") VALUES ('blob-hash', '\\x00'::bytea, 1, now())`,
  `INSERT INTO "public"."BlobRef" ("sessionId", hash) VALUES ('ses_1', 'blob-hash')`,
  `INSERT INTO "public"."ChangeBlob" (hash, size, "createdAt") VALUES ('change-hash', 1, now())`,
  `INSERT INTO "public"."WorktreeChanges" (id, "sessionId", repo, "worktreePath", fingerprint, "updatedAt")
   VALUES ('wt_1', 'ses_1', 'o/r', '/tmp/wt', 'fp', now())`,
  `INSERT INTO "public"."WorktreeChangedFile" ("checkoutId", path, status, additions, deletions, "binary")
   VALUES ('wt_1', 'src/a.ts', 'modified', 1, 2, false)`,
  `INSERT INTO "public"."SessionBranch" ("sessionId", "headRepo", branch, "firstSeenSeq")
   VALUES ('ses_1', 'o/r', 'atlas/work', 1)`,
  `INSERT INTO "public"."SessionPullRequest" ("sessionId", "repoFullName", "prNumber")
   VALUES ('ses_1', 'o/r', 12)`,
  `INSERT INTO "public"."SessionView" ("sessionId", "threadId", "atSeq", version, state, "updatedAt")
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

describe('the v2 table move to public', () => {
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
    await applyMigrations(client, { stopBefore: MIGRATION })
    for (const statement of SEEDS) await client.query(statement)
    seeded = []
    for (const [oldTable] of MOVED_TABLES) {
      seeded.push({ table: oldTable, count: await countsOf(client, 'v2', oldTable) })
    }
    expect(seeded.every((entry) => entry.count > 0)).toBe(true)
    await applyMigration({ client, directory: MIGRATION })
  }, 180_000)

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  it('moves every row into public under its new name', async () => {
    for (const { table, count } of seeded) {
      const [, next] = MOVED_TABLES.find(([oldTable]) => oldTable === table) as [string, string]
      expect({ table: next, count: await countsOf(client, 'public', next) }).toEqual({
        table: next,
        count,
      })
    }
  })

  it('leaves a view in v2 for every old name and no base table behind', async () => {
    for (const [oldTable] of MOVED_TABLES) {
      expect({
        relation: `v2.${oldTable}`,
        kind: await relkindOf(client, `v2."${oldTable}"`),
      }).toEqual({
        relation: `v2.${oldTable}`,
        kind: 'v',
      })
    }
    const left = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'v2' AND c.relkind = 'r'`,
    )
    expect(left.rows[0]?.n).toBe('0')
  })

  it('keeps the old upsert, lock and presence statements working through the views', async () => {
    const upsert = await client.query<{ sessionId: string; epoch: number; attempts: number }>(
      `INSERT INTO "public"."Lease" ("sessionId", epoch, "holderHostId", "wantsHolder", attempts)
       VALUES ('ses_1', 2, 7, true, 3)
       ON CONFLICT ("sessionId") DO UPDATE
         SET epoch = EXCLUDED.epoch, "holderHostId" = EXCLUDED."holderHostId",
             "wantsHolder" = EXCLUDED."wantsHolder", attempts = EXCLUDED.attempts
       RETURNING "sessionId", epoch, attempts`,
    )
    expect(upsert.rows).toEqual([{ sessionId: 'ses_1', epoch: 2, attempts: 3 }])

    await client.query('BEGIN')
    const claimed = await client.query<{ inboxId: number }>(
      `SELECT "inboxId" FROM "public"."InboxEntry"
        WHERE "consumedSeq" IS NULL ORDER BY "inboxId" LIMIT 1 FOR UPDATE SKIP LOCKED`,
    )
    const locked = await client.query(
      `SELECT 1 FROM "public"."InboxEntry" l FOR UPDATE OF l SKIP LOCKED`,
    )
    await client.query('COMMIT')
    expect(claimed.rows).toEqual([{ inboxId: 1 }])
    expect(locked.rowCount).toBe(2)

    const host = await client.query<{ id: number }>(
      'INSERT INTO "public"."Host" (label, "startedAt") VALUES (\'presence\', now()) RETURNING id',
    )
    expect(typeof host.rows[0]?.id).toBe('number')
  })

  it('keeps Event append-only through the view', async () => {
    const appended = await client.query<{ id: string }>(
      `INSERT INTO "public"."Event" ("threadId", seq, id, epoch, type, "runId", at, "prevHash", hash, canonical)
       VALUES ('thr_1', 2, 'evt_2', 1, 'message', 'run_1', now(), 'h1', 'h2', '{}') RETURNING id`,
    )
    expect(appended.rows).toEqual([{ id: 'evt_2' }])
    await expect(
      client.query(`UPDATE "public"."Event" SET type = 'x' WHERE id = 'evt_2'`),
    ).rejects.toThrow(/append-only/)
    await expect(client.query(`DELETE FROM "public"."Event" WHERE id = 'evt_2'`)).rejects.toThrow(
      /append-only/,
    )
    expect(await countsOf(client, 'public', 'Event')).toBe(2)
  })

  it('serves the new statements from the public tables', async () => {
    await client.query(
      `INSERT INTO "public"."SessionDraft" ("userId", "scopeKey", "sessionId", text, attachments, "updatedAt")
       VALUES ('u', 'scope', 'ses_1', 'second', '[]', now())
       ON CONFLICT ("userId", "scopeKey") DO UPDATE SET text = EXCLUDED.text`,
    )
    const drafts = await client.query<{ text: string }>(
      `SELECT text FROM "public"."SessionDraft" WHERE "userId" = 'u'`,
    )
    expect(drafts.rows).toEqual([{ text: 'second' }])
    const inbox = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM "public"."InboxEntry" WHERE "sessionId" = 'ses_1'`,
    )
    expect(inbox.rows[0]?.n).toBe('2')
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
