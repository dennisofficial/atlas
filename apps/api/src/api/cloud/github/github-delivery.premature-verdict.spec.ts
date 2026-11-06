import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import { type CheckSuiteShape, checkSuiteInputOf } from './github-check-suites'
import { checkRunInputOf, commitStatusInputOf } from './github-commit-checks'
import { RUNNING, setupTrackedPr } from './github-delivery.checks.fixture'
import { checkRunPayload, prepareDelivery, REST_FIELDS } from './github-delivery.fixture'

const SHA = 'abc123'
const ACTIONS = { slug: 'github-actions' }

const statusPayload = {
  id: 9,
  sha: SHA,
  context: 'vercel',
  state: 'success',
  created_at: '2026-11-02T06:19:01Z',
  updated_at: '2026-11-02T06:19:01Z',
  repository: { full_name: 'compai/app' },
}

const runPayload = (over: object) =>
  checkRunPayload({ ...over, app: ACTIONS } as Parameters<typeof checkRunPayload>[0])

const suitePayload = (suite: object) => ({
  action: 'completed',
  check_suite: { head_sha: SHA, head_branch: 'dennis/add-the-thing', ...suite },
  repository: { full_name: 'compai/app' },
})

const seedPriorRunnerRun = () =>
  db.orm.public.GithubCommitCheck.create({
    repoFullName: 'compai/app',
    headSha: 'older000',
    checkKey: 'run:900',
    name: 'build',
    outcome: 'passed',
    sourceUpdatedAt: new Date('2026-11-01T00:00:00Z'),
    appSlug: ACTIONS.slug,
  })

const restReading = (suites: CheckSuiteShape[]) =>
  vi.fn(async (args: unknown) => {
    const { collectChecks } = args as {
      collectChecks?: (value: {
        headSha: string
        checks: ReturnType<typeof checkSuiteInputOf>[]
      }) => void
    }
    const rows = await db.orm.public.GithubCommitCheck.where({
      repoFullName: 'compai/app',
      headSha: SHA,
    }).all()
    const stored = rows
      .filter((row) => row.checkKey.startsWith('status:'))
      .map((row) =>
        commitStatusInputOf({
          context: row.name ?? '',
          state: 'success',
          created_at: row.startedAt,
          updated_at: row.sourceUpdatedAt.toISOString(),
        }),
      )
    const runs = rows
      .filter((row) => row.checkKey.startsWith('run:'))
      .map((row) =>
        checkRunInputOf({
          id: Number(row.checkKey.slice(4)),
          name: row.name ?? '',
          status: row.outcome === 'running' ? 'in_progress' : 'completed',
          conclusion: row.outcome === 'passed' ? 'success' : null,
          started_at: row.startedAt,
          completed_at: row.outcome === 'running' ? null : row.sourceUpdatedAt.toISOString(),
          app: row.appSlug === null ? null : { slug: row.appSlug },
        }),
      )
    collectChecks?.({
      headSha: SHA,
      checks: [...stored, ...runs, ...suites.map(checkSuiteInputOf)] as never,
    })
    return { ...REST_FIELDS }
  })

const verdicts = async () => (await prEventRows()).filter((row) => row.kind === 'verdict')

describe('premature CI verdicts', () => {
  useTestDatabase()
  beforeEach(prepareDelivery)

  it('announces nothing while the runner suite is pending, then exactly one green', async () => {
    await seedPriorRunnerRun()
    const suites: CheckSuiteShape[] = [
      { id: 1, status: 'queued', app: ACTIONS },
      { id: 2, status: 'queued', app: { slug: 'sentry' } },
    ]
    const readPullRequest = restReading(suites)
    const { service } = await setupTrackedPr(readPullRequest as never)

    await service.handle({ event: 'status', payload: statusPayload })
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await verdicts()).toHaveLength(0)

    await service.handle({
      event: 'check_run',
      payload: runPayload({ id: 11, ...RUNNING }),
    })
    await service.handle({
      event: 'check_run',
      payload: runPayload({ id: 11 }),
    })
    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(await verdicts()).toHaveLength(0)

    suites[0] = { id: 1, status: 'completed', app: ACTIONS }
    await service.handle({
      event: 'check_suite',
      payload: suitePayload(suites[0]),
    })
    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      payload: { verdict: 'green', settled: true },
    })
  })

  it('holds a head with no runs unsettled when the repo has a runner app', async () => {
    await seedPriorRunnerRun()
    const { service } = await setupTrackedPr(restReading([]) as never)

    await service.handle({ event: 'status', payload: statusPayload })
    expect(await verdicts()).toHaveLength(0)

    await service.handle({
      event: 'check_run',
      payload: runPayload({ id: 11 }),
    })
    expect(await verdicts()).toHaveLength(1)
  })

  it('settles green from statuses alone when no runner app is known', async () => {
    const { service } = await setupTrackedPr(restReading([]) as never)
    await service.handle({ event: 'status', payload: statusPayload })
    expect(await verdicts()).toHaveLength(1)
  })

  it('never lets a non-runner queued suite block settlement', async () => {
    const { service } = await setupTrackedPr(
      restReading([{ id: 2, status: 'queued', app: { slug: 'vercel' } }]) as never,
    )
    await service.handle({ event: 'status', payload: statusPayload })
    expect(await verdicts()).toHaveLength(1)
  })

  it('ignores the queued suite of an app that created runs on only a few heads', async () => {
    const seedRun = (args: { headSha: string; id: number; appSlug: string }) =>
      db.orm.public.GithubCommitCheck.create({
        repoFullName: 'compai/app',
        headSha: args.headSha,
        checkKey: `run:${args.id}`,
        name: 'build',
        outcome: 'passed',
        sourceUpdatedAt: new Date('2026-11-01T00:00:00Z'),
        appSlug: args.appSlug,
      })
    for (const n of [1, 2, 3])
      await seedRun({ headSha: `older${n}`, id: 900 + n, appSlug: 'github-actions' })
    await seedRun({ headSha: 'older1', id: 950, appSlug: 'vercel' })
    const { service } = await setupTrackedPr(
      restReading([
        { id: 1, status: 'completed', app: ACTIONS },
        { id: 2, status: 'queued', app: { slug: 'vercel' } },
      ]) as never,
    )

    await service.handle({ event: 'check_run', payload: runPayload({ id: 11 }) })

    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })

  it('announces green, failed, green across re-runs with distinct keys, and replays quietly', async () => {
    const { service } = await setupTrackedPr(restReading([]) as never)
    const at = (minute: number) => ({
      started_at: `2026-11-02T06:${minute}:00Z`,
      completed_at: `2026-11-02T06:${minute}:30Z`,
    })
    const send = (id: number, over: object) =>
      service.handle({
        event: 'check_run',
        payload: runPayload({ id, ...over }),
      })

    await send(11, {
      ...at(20),
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
    })
    await send(11, at(20))
    await send(12, {
      ...at(30),
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
    })
    await send(12, { ...at(30), conclusion: 'failure' })
    await send(13, {
      ...at(40),
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
    })
    await send(13, at(40))
    const final = runPayload({ id: 13, ...at(40) })
    await service.handle({ event: 'check_run', payload: final })

    const emitted = await verdicts()
    expect(emitted.map((row) => (row.payload as { verdict: string }).verdict)).toEqual([
      'green',
      'failed',
      'green',
    ])
    expect(new Set(emitted.map((row) => row.dedupeKey)).size).toBe(3)
  })
})
