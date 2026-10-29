import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'

const SESSIONS_MIGRATION = '20261029T1820_sessions'
const DATABASE = `atlas_test_backfill_${process.pid}`

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

describe('sessions migration backfill', () => {
  let client: pg.Client

  beforeAll(async () => {
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.query(`CREATE DATABASE ${quoteIdent(DATABASE)}`)
    await lane.end()
    client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: DATABASE }) })
    await client.connect()
    await applyMigrations(client, { stopBefore: SESSIONS_MIGRATION })

    await client.query(
      `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('u', 'u', 'u@t.local', now())`,
    )
    await client.query(
      `INSERT INTO "Project" (id, name, "ownerUserId", "updatedAt") VALUES ('p', 'p', 'u', now())`,
    )
    const thread = (
      id: string,
      spawner: string | null,
      agentType: string | null,
      title: string | null,
    ) =>
      client.query(
        `INSERT INTO "Thread" (id, "userId", "projectId", repo, title, "spawnerThreadId", "agentType", "createdAt", "updatedAt", "pinnedAt")
         VALUES ($1, 'u', 'p', 'o/r', $4, $2, $3, now(), now(), now())`,
        [id, spawner, agentType, title],
      )
    await thread('main', null, null, 'Main title')
    await thread('sub', 'main', 'explore', null)
    await thread('subsub', 'sub', 'explore', null)
    await thread('mate', 'main', 'teammate', null)
    await thread('mate-sub', 'mate', 'explore', null)
    await client.query(
      `INSERT INTO "CloudSandbox" (id, "threadId", "userId", "sandboxId", name, region, state, "lastActivityAt", "tokenHash", "createdAt", "updatedAt")
       VALUES ('c', 'main', 'u', 'sb', 'n', 'iad1', 'running', now(), 'h', now(), now())`,
    )
    await client.query(
      `INSERT INTO "SandboxBootStep" (id, "threadId", step, state) VALUES ('b', 'main', 's', 'ok')`,
    )

    await applyMigration({ client, directory: SESSIONS_MIGRATION })
  })

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  const sessionOf = async (threadId: string) =>
    (
      await client.query<{ sessionId: string }>(`SELECT "sessionId" FROM "Thread" WHERE id = $1`, [
        threadId,
      ])
    ).rows[0]?.sessionId

  it('gives a main thread its own session carrying the moved columns', async () => {
    const found = await client.query(`SELECT * FROM "Session" WHERE "mainThreadId" = 'main'`)
    expect(found.rows).toHaveLength(1)
    expect(found.rows[0]).toMatchObject({
      id: 'ses_main',
      userId: 'u',
      projectId: 'p',
      repo: 'o/r',
      title: 'Main title',
      managedBySessionId: null,
    })
    expect(found.rows[0].pinnedAt).toBeInstanceOf(Date)
    expect(await sessionOf('main')).toBe('ses_main')
  })

  it('puts a sub-agent in its spawner session and a nested sub-agent in the root session', async () => {
    expect(await sessionOf('sub')).toBe('ses_main')
    expect(await sessionOf('subsub')).toBe('ses_main')
  })

  it('gives a teammate its own session managed by the spawner session, and its sub-agents follow it', async () => {
    expect(await sessionOf('mate')).toBe('ses_mate')
    expect(await sessionOf('mate-sub')).toBe('ses_mate')
    const found = await client.query(
      `SELECT "managedBySessionId", "mainThreadId" FROM "Session" WHERE id = 'ses_mate'`,
    )
    expect(found.rows[0]).toEqual({ managedBySessionId: 'ses_main', mainThreadId: 'mate' })
  })

  it('creates sessions only for main and teammate threads', async () => {
    const ids = await client.query<{ id: string }>(`SELECT id FROM "Session" ORDER BY id`)
    expect(ids.rows.map((row) => row.id)).toEqual(['ses_main', 'ses_mate'])
  })

  it('re-keys the sandbox and its boot steps to the session', async () => {
    const sandbox = await client.query(`SELECT "sessionId" FROM "CloudSandbox" WHERE id = 'c'`)
    const steps = await client.query(`SELECT "sessionId" FROM "SandboxBootStep"`)
    expect(sandbox.rows).toEqual([{ sessionId: 'ses_main' }])
    expect(steps.rows).toEqual([{ sessionId: 'ses_main' }])
  })
})
