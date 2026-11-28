import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ESkillScope, type SkillUsage } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import { legacyUsageSql, NOW, seedUsageFixture, USER } from './skill-usage.fixture'
import { SkillUsageService, usageStatement } from './skill-usage.service'

type UsageRow = { key: string | null; usedCount30d: number; lastUsedAt: Date | null }

const scopes = [
  { scope: ESkillScope.Personal, multiplier: 4 },
  { scope: ESkillScope.Project, projectId: 'project-a', multiplier: 1 },
  { scope: ESkillScope.Group, groupId: 'group-a', multiplier: 2 },
] as const

const normalize = (rows: UsageRow[]) =>
  new Map<string, SkillUsage>(
    rows.flatMap((row) =>
      row.key === null
        ? []
        : [
            [
              row.key,
              { usedCount30d: row.usedCount30d, lastUsedAt: row.lastUsedAt?.toISOString() ?? null },
            ],
          ],
    ),
  )

describe('SkillUsageService candidate scan', () => {
  const testDb = useTestDatabase()
  const usage = new SkillUsageService()
  beforeEach(seedUsageFixture)

  for (const scope of scopes) {
    it(`preserves legacy counts and timestamps for ${scope.scope} scope`, async () => {
      const { pool } = testDb()
      const projectId = 'projectId' in scope ? scope.projectId : undefined
      const groupId = 'groupId' in scope ? scope.groupId : undefined
      const baseline = await pool.query<UsageRow>(legacyUsageSql, [USER, projectId, groupId])
      const actual = await usage.usageFor({
        userId: USER,
        ...scope,
        skillNames: ['review', 'escaped', 'expired'],
      })
      expect(actual).toEqual(normalize(baseline.rows))
      expect(actual).toEqual(
        new Map([
          ['review', { usedCount30d: 2 * scope.multiplier, lastUsedAt: NOW.toISOString() }],
          [
            'escaped',
            {
              usedCount30d: 2 * scope.multiplier,
              lastUsedAt: new Date(NOW.getTime() - 8 * 60_000).toISOString(),
            },
          ],
        ]),
      )
    })
  }

  it('does not scan when no skills are requested', async () => {
    expect(
      await usage.usageFor({ userId: USER, scope: ESkillScope.Personal, skillNames: [] }),
    ).toEqual(new Map())
  })

  it('uses the partial candidate index for every scope', async () => {
    const { pool } = testDb()
    await pool.query(`INSERT INTO "Event" ("threadId", seq, id, epoch, type, "runId", at, "prevHash", hash, canonical)
      SELECT 'thread-a', n, 'noise-' || n, 1, 'tool-called', 'run', now(), 'h', 'h',
        '{"name":"bash","input":{"command":"' || repeat(md5(n::text), 100) || '"}}'
      FROM generate_series(101, 10100) n`)
    await pool.query('ANALYZE "Event"')
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'Event' AND indexname LIKE 'Event_skill_usage%'`,
    )
    const indexName = indexes.rows[0]?.indexname
    expect(indexName).toBeDefined()
    for (const scope of scopes) {
      const args = {
        userId: USER,
        ...('projectId' in scope ? { projectId: scope.projectId } : {}),
        ...('groupId' in scope ? { groupId: scope.groupId } : {}),
      }
      const plan = testDb().db.toSql(usageStatement(args).returnsRow({}).build())
      const baseline = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${legacyUsageSql}`,
        [
          USER,
          'projectId' in scope ? scope.projectId : null,
          'groupId' in scope ? scope.groupId : null,
        ],
      )
      const result = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${plan.sql}`,
        [...plan.params],
      )
      const text = result.rows.map((row) => row['QUERY PLAN']).join('\n')
      expect(baseline.rows.map((row) => row['QUERY PLAN']).join('\n')).not.toContain(
        indexName ?? 'missing-index',
      )
      expect(text).toContain(indexName ?? 'missing-index')
    }
  })
})
