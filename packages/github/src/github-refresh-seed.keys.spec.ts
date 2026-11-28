import { db, type Row } from '@dltech/atlas-db'
import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { ensureUsers, seedSubscription } from './testing/github-seed'
import { ensurePullTarget, seedSubscriptionTargets } from './github-refresh-seed'
import type { TransportSelector } from './github-transport-selector'

const polling = { polls: async () => true } as unknown as TransportSelector

const versions = async (): Promise<Map<string, string>> => {
  const rows = await db.query(
    db.raw.sql`SELECT id, xmin::text AS version FROM "GithubTrackingTarget"`
      .returnsRow({ id: 'pg/text@1', version: 'pg/text@1' })
      .build(),
  )
  return new Map(rows.map((row) => [row.id, row.version]))
}

const trackedReads = async (run: () => Promise<void>): Promise<string[]> => {
  const counter = countQueries()
  try {
    await run()
  } finally {
    counter.stop()
  }
  return counter.statements.filter(
    (sql) => sql.startsWith('SELECT') && sql.includes('FROM "public"."GithubTrackingTarget"'),
  )
}

const expectExactKeys = (args: { reads: string[]; count: number }): void => {
  expect(args.reads).toHaveLength(1)
  const sql = args.reads[0] ?? ''
  const where = sql.slice(sql.indexOf('WHERE'))
  for (const field of ['userId', 'kind', 'repoFullName', 'branch', 'prNumber']) {
    expect(where.match(new RegExp(`"${field}" =`, 'g'))).toHaveLength(args.count)
  }
}

const seedHistory = async (now: Date): Promise<void> => {
  await ensureUsers('usr_1', 'usr_2')
  await db.execute(
    db.raw.sql`INSERT INTO "GithubTrackingTarget"
      (id, "userId", kind, "repoFullName", branch, "prNumber", "liveUntil", "nextDueAt")
      SELECT 'historical-' || i,
        CASE WHEN i % 2 = 0 THEN 'usr_1' ELSE 'usr_2' END,
        CASE WHEN i % 2 = 0 THEN 'head' ELSE 'pull-request' END,
        CASE WHEN i % 3 = 0 THEN 'compai/app' ELSE 'compai/inactive' END,
        CASE WHEN i % 2 = 0 THEN 'inactive-' || i ELSE '' END,
        CASE WHEN i % 2 = 0 THEN 0 ELSE i + 1000 END,
        ${now.toISOString()}::timestamptz - interval '1 minute',
        ${now.toISOString()}::timestamptz
      FROM generate_series(0, 1999) AS i`
      .affectedCount()
      .build(),
  )
}

const targets = (): Promise<Row<'GithubTrackingTarget'>[]> =>
  db.orm.public.GithubTrackingTarget.all().toArray()

const hourAfter = (now: Date): Date => new Date(now.getTime() + 3_600_000)

describe('refresh seed key reads', () => {
  useTestDatabase()

  it('reads only deduplicated normalized live keys among thousands of historical targets', async () => {
    const now = new Date()
    const liveUntil = hourAfter(now)
    await seedHistory(now)
    await seedSubscription({ prNumber: 42, liveUntil })
    const changed = await seedSubscription({ prNumber: 43, threadId: 'changed', liveUntil })
    await seedSubscription({ prNumber: null, branch: 'main', pollBacked: true, liveUntil })
    await seedSubscription({ userId: 'usr_2', prNumber: 42, liveUntil })
    await seedSubscriptionTargets({ transport: polling, now })
    const before = await targets()
    const beforeVersions = await versions()
    const movedUntil = hourAfter(liveUntil)
    await db.orm.public.GithubSubscription.where({ id: changed.id }).update({
      liveUntil: movedUntil,
    })
    await seedSubscription({
      repoFullName: 'CompAI/App',
      prNumber: 42,
      threadId: 'duplicate',
      liveUntil,
    })
    await seedSubscription({ prNumber: 44, threadId: 'new', liveUntil })
    await seedSubscription({ prNumber: null, branch: '', threadId: 'empty', pollBacked: true })
    await seedSubscription({ prNumber: null, branch: 'not-polled', threadId: 'not-polled' })
    await seedSubscription({
      prNumber: null,
      branch: '#workflow:ci.yml@main',
      threadId: 'workflow',
      pollBacked: true,
    })
    await seedSubscription({ prNumber: 45, threadId: 'expired', liveUntil: new Date(0) })
    await seedSubscription({
      repoFullName: 'compai/hooked',
      prNumber: null,
      branch: 'main',
      pollBacked: true,
    })
    const transport = {
      polls: async (repo: string) => repo !== 'compai/hooked',
    } as unknown as TransportSelector

    const reads = await trackedReads(() => seedSubscriptionTargets({ transport, now }))

    expectExactKeys({ reads, count: 5 })
    const after = await targets()
    const afterVersions = await versions()
    expect(after).toHaveLength(before.length + 1)
    for (const row of before) {
      const repeated = after.find((target) => target.id === row.id)
      if (row.userId === 'usr_1' && row.prNumber === 43) {
        expect(repeated).toEqual({ ...row, liveUntil: movedUntil })
        expect(afterVersions.get(row.id)).not.toBe(beforeVersions.get(row.id))
        continue
      }
      expect(repeated).toEqual(row)
      expect(afterVersions.get(row.id)).toBe(beforeVersions.get(row.id))
    }
    expect(after.find((row) => row.prNumber === 44)).toMatchObject({
      userId: 'usr_1',
      kind: 'pull-request',
      repoFullName: 'compai/app',
      branch: '',
      prNumber: 44,
      liveUntil,
      nextDueAt: now,
    })
  })

  it('reads one normalized pull key and leaves all other target versions unchanged', async () => {
    const now = new Date()
    const liveUntil = hourAfter(now)
    await seedHistory(now)
    const args = { userId: 'usr_1', repoFullName: 'CompAI/App', prNumber: 42, liveUntil, now }

    expectExactKeys({ reads: await trackedReads(() => ensurePullTarget(args)), count: 1 })
    const before = await targets()
    const beforeVersions = await versions()
    expect(before.find((row) => row.prNumber === 42)).toMatchObject({
      repoFullName: 'compai/app',
      branch: '',
      liveUntil,
      nextDueAt: now,
    })
    expectExactKeys({ reads: await trackedReads(() => ensurePullTarget(args)), count: 1 })
    expect(await targets()).toEqual(before)
    expect(await versions()).toEqual(beforeVersions)

    const movedUntil = hourAfter(liveUntil)
    expectExactKeys({
      reads: await trackedReads(() => ensurePullTarget({ ...args, liveUntil: movedUntil })),
      count: 1,
    })
    const after = await targets()
    const afterVersions = await versions()
    for (const row of before) {
      if (row.prNumber === 42) {
        expect(after.find((target) => target.id === row.id)).toEqual({
          ...row,
          liveUntil: movedUntil,
        })
        expect(afterVersions.get(row.id)).not.toBe(beforeVersions.get(row.id))
        continue
      }
      expect(after.find((target) => target.id === row.id)).toEqual(row)
      expect(afterVersions.get(row.id)).toBe(beforeVersions.get(row.id))
    }
  })

  it('does not read targets when no subscription needs one', async () => {
    await seedSubscription({ prNumber: null, branch: '' })
    expect(
      await trackedReads(() => seedSubscriptionTargets({ transport: polling, now: new Date() })),
    ).toHaveLength(0)
  })
})
