import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'

const DDL_MIGRATION = '20261103T1832_skills_storage'
const DATA_MIGRATION = '20261103T1832_skills_userfile_backfill'
const DATABASE = `atlas_test_skills_backfill_${process.pid}`

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

type SkillRow = { id: string; userId: string | null; projectId: string | null; name: string }
type SkillFileRow = {
  skillId: string
  path: string
  revision: number
  contentHash: string
  content: Buffer
  isText: boolean
  size: number
}

describe('skills UserFile backfill migration', () => {
  let client: pg.Client

  beforeAll(async () => {
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.query(`CREATE DATABASE ${quoteIdent(DATABASE)}`)
    await lane.end()
    client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: DATABASE }) })
    await client.connect()
    await applyMigrations(client, { stopBefore: DDL_MIGRATION })

    await client.query(
      `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('u1', 'u1', 'u1@t.local', now()), ('u2', 'u2', 'u2@t.local', now())`,
    )

    const file = (
      id: string,
      userId: string,
      path: string,
      {
        revision = 1,
        content = `content of ${path}`,
        updatedAt = '2026-01-01T00:00:00Z',
        tombstoned = false,
      }: {
        revision?: number
        content?: string | null
        updatedAt?: string
        tombstoned?: boolean
      } = {},
    ) =>
      client.query(
        `INSERT INTO "UserFile" (id, "userId", tree, path, revision, "contentHash", content, "tombstonedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, 'skills', $3, $4, md5(coalesce($5, '')), convert_to($5, 'utf8'), $6, $7, $7)`,
        [id, userId, path, revision, content, tombstoned ? new Date() : null, updatedAt],
      )

    // review: identical copies in .agents and .claude — merge to one skill, one file
    await file('a1', 'u1', '.agents/review/SKILL.md', { updatedAt: '2026-01-01T00:00:00Z' })
    await file('a2', 'u1', '.claude/review/SKILL.md', { updatedAt: '2026-01-02T00:00:00Z' })
    // review: helper file only in .claude — still merged
    await file('a3', 'u1', '.claude/review/checklist.md', { updatedAt: '2026-01-02T00:00:00Z' })
    // ship: divergent copies, .claude newer → .claude content wins
    await file('b1', 'u1', '.agents/ship/SKILL.md', {
      revision: 3,
      content: 'old agents copy',
      updatedAt: '2026-02-01T00:00:00Z',
    })
    await file('b2', 'u1', '.claude/ship/SKILL.md', {
      revision: 5,
      content: 'new claude copy',
      updatedAt: '2026-03-01T00:00:00Z',
    })
    // ship: divergent copies, .agents newer by updatedAt despite lower revision → .agents wins
    await file('c1', 'u2', '.agents/lint/SKILL.md', {
      revision: 1,
      content: 'agents wins on time',
      updatedAt: '2026-03-01T00:00:00Z',
    })
    await file('c2', 'u2', '.claude/lint/SKILL.md', {
      revision: 9,
      content: 'claude higher revision',
      updatedAt: '2026-02-01T00:00:00Z',
    })
    // casing: .Agents name folds to lowercase
    await file('d1', 'u1', '.agents/MixedCase/SKILL.md', { content: 'mixed' })
    // tombstoned and null-content rows are skipped
    await file('e1', 'u1', '.agents/dead/SKILL.md', { tombstoned: true })
    await file('e2', 'u1', '.agents/empty/SKILL.md', { content: null })
    // paths that do not resolve to <skill>/<file> are ignored
    await file('f1', 'u1', '.agents/orphan', {})
    await file('f2', 'u1', 'README.md', {})
    // a binary file
    await file('g1', 'u1', '.agents/review/logo.png', { content: 'png-bytes' })

    await applyMigration({ client, directory: DDL_MIGRATION })
    await applyMigration({ client, directory: DATA_MIGRATION })
  })

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  const skills = async () =>
    (
      await client.query<SkillRow>(
        `SELECT id, "userId", "projectId", name FROM "Skill" ORDER BY "userId", name`,
      )
    ).rows

  const filesOf = async (skillId: string) =>
    (
      await client.query<SkillFileRow>(
        `SELECT "skillId", path, revision, "contentHash", content, "isText", size FROM "SkillFile" WHERE "skillId" = $1 ORDER BY path`,
        [skillId],
      )
    ).rows

  it('creates one skill per user and lowercase name, flavour prefix stripped', async () => {
    const rows = await skills()
    expect(rows.map((row) => [row.userId, row.name])).toEqual([
      ['u1', 'mixedcase'],
      ['u1', 'review'],
      ['u1', 'ship'],
      ['u2', 'lint'],
    ])
    for (const row of rows) expect(row.projectId).toBeNull()
  })

  it('keeps identical flavour copies as one file and picks the newest copy when they diverge', async () => {
    const review = (await skills()).find((row) => row.userId === 'u1' && row.name === 'review')
    if (review === undefined) throw new Error('review skill missing')
    const files = await filesOf(review.id)
    expect(files.map((file) => file.path)).toEqual(['SKILL.md', 'checklist.md', 'logo.png'])

    const ship = (await skills()).find((row) => row.userId === 'u1' && row.name === 'ship')
    if (ship === undefined) throw new Error('ship skill missing')
    const shipFiles = await filesOf(ship.id)
    expect(shipFiles).toHaveLength(1)
    expect(shipFiles[0]?.content.toString()).toBe('new claude copy')
    expect(shipFiles[0]?.revision).toBe(5)

    const lint = (await skills()).find((row) => row.userId === 'u2' && row.name === 'lint')
    if (lint === undefined) throw new Error('lint skill missing')
    const lintFiles = await filesOf(lint.id)
    expect(lintFiles).toHaveLength(1)
    expect(lintFiles[0]?.content.toString()).toBe('agents wins on time')
  })

  it('carries contentHash and revision from the winning row and computes isText and size', async () => {
    const review = (await skills()).find((row) => row.userId === 'u1' && row.name === 'review')
    if (review === undefined) throw new Error('review skill missing')
    const files = await filesOf(review.id)
    const skillMd = files.find((file) => file.path === 'SKILL.md')
    const logo = files.find((file) => file.path === 'logo.png')
    expect(skillMd?.isText).toBe(true)
    expect(skillMd?.size).toBe(Buffer.from('content of .claude/review/SKILL.md').length)
    expect(skillMd?.contentHash).toBe(
      (
        await client.query<{ md5: string }>(`SELECT md5($1)`, [
          'content of .claude/review/SKILL.md',
        ])
      ).rows[0]?.md5,
    )
    expect(logo?.isText).toBe(false)
    expect(logo?.size).toBe('png-bytes'.length)
  })

  it('skips tombstoned rows, null-content rows, and paths without a skill/file shape', async () => {
    const names = (await skills()).map((row) => row.name)
    expect(names).not.toContain('dead')
    expect(names).not.toContain('empty')
    expect(names).not.toContain('orphan')
    expect(names).not.toContain('readme')
  })

  it('is idempotent against a partially re-run insert via ON CONFLICT', async () => {
    const before = await skills()
    const rerun = await client.query(`
      INSERT INTO "Skill" (id, "userId", "projectId", name, "updatedAt")
      SELECT 'dup', "userId", NULL, name, now() FROM "Skill"
      ON CONFLICT DO NOTHING
    `)
    expect(rerun.rowCount).toBe(0)
    expect(await skills()).toEqual(before)
  })
})
