import { ECheckOutcome } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import {
  COMMIT_CHECK_TOUCH_MS,
  checkRunInputOf,
  recordCommitChecksLocked,
  type CheckRunShape,
  type CommitCheckInput,
} from './github-commit-checks'

const REPO = 'compai/app'
const HEAD = 'sha-unchanged'

const runOf = (over: Partial<CheckRunShape> = {}): CommitCheckInput =>
  checkRunInputOf({
    id: 7,
    name: 'build',
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-11-13T00:00:00Z',
    completed_at: null,
    app: { slug: 'gh' },
    html_url: 'https://example.test/7',
    output: { title: 'build', summary: 'so far so good', annotations_count: 1 },
    ...over,
  })

const failedRunOf = (over: Partial<CheckRunShape> = {}): CommitCheckInput => ({
  ...runOf({
    status: 'completed',
    conclusion: 'failure',
    completed_at: '2026-11-13T00:01:00Z',
    ...over,
  }),
  annotations: [{ message: 'boom', path: 'src/a.ts', line: 3, title: 'TypeError' }],
})

const statusCheck = (over: Partial<CommitCheckInput> = {}): CommitCheckInput => ({
  checkKey: 'status:ci',
  sourceId: '1',
  name: 'ci',
  startedAt: '2026-11-13T00:00:00Z',
  outcome: ECheckOutcome.Passed,
  sourceUpdatedAt: new Date('2026-11-13T00:05:00Z'),
  isRun: false,
  detailsUrl: 'https://example.test/ci',
  summary: 'green',
  ...over,
})

const record = (checks: readonly CommitCheckInput[]) =>
  recordCommitChecksLocked({ repoFullName: REPO, headSha: HEAD, checks })

const rowOf = async (checkKey: string) =>
  db.orm.public.GithubCommitCheck.where({ repoFullName: REPO, headSha: HEAD, checkKey }).first()

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const backdate = (checkKey: string, at: Date) =>
  db.execute(
    db.raw
      .sql`UPDATE "GithubCommitCheck" SET "updatedAt" = ${at.toISOString()}::timestamptz WHERE "repoFullName" = ${REPO} AND "headSha" = ${HEAD} AND "checkKey" = ${checkKey}`
      .affectedCount()
      .build(),
  )

describe('recordCommitChecks unchanged replay', () => {
  useTestDatabase()

  it('does not write a row whose persisted fields are identical', async () => {
    const check = failedRunOf()
    await record([check])
    const at = minutesAgo(5)
    await backdate(check.checkKey, at)

    await record([check])

    const held = await rowOf(check.checkKey)
    expect(held?.updatedAt).toEqual(at)
    expect(held?.outcome).toBe('failed')
    expect(held?.annotations).toHaveLength(1)
  })

  it('treats reordered annotation objects as the same jsonb value', async () => {
    const check = failedRunOf()
    await record([check])
    const at = minutesAgo(5)
    await backdate(check.checkKey, at)

    await record([
      {
        ...check,
        annotations: [{ title: 'TypeError', line: 3, path: 'src/a.ts', message: 'boom' }],
      },
    ])

    expect((await rowOf(check.checkKey))?.updatedAt).toEqual(at)
  })

  it('rewrites an unchanged row older than the touch window', async () => {
    const check = failedRunOf()
    await record([check])
    await backdate(check.checkKey, new Date(Date.now() - 2 * COMMIT_CHECK_TOUCH_MS))

    await record([check])

    const held = await rowOf(check.checkKey)
    expect(held?.updatedAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime())
    expect(held?.annotations).toHaveLength(1)
  })

  it('stores the last input when one call repeats a check key', async () => {
    const first = statusCheck()
    await record([first])

    await record([statusCheck({ summary: 'flaky' }), first])

    const held = await rowOf(first.checkKey)
    expect(held?.summary).toBe('green')
  })

  it('still writes a check whose fields changed', async () => {
    const running = runOf()
    await record([running])
    const at = minutesAgo(5)
    await backdate(running.checkKey, at)

    const completed = runOf({
      status: 'completed',
      conclusion: 'failure',
      completed_at: '2026-11-13T00:01:00Z',
    })
    await record([completed])

    const held = await rowOf(running.checkKey)
    expect(held?.outcome).toBe('failed')
    expect(held?.conclusion).toBe('failure')
    expect(held?.sourceUpdatedAt).toEqual(new Date('2026-11-13T00:01:00Z'))
    expect(held?.updatedAt.getTime()).toBeGreaterThan(at.getTime())
  })
})
