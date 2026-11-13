import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import { checkRunInputOf, commitStatusInputOf } from './github-commit-checks'
import { RUNNING, setupTrackedPr } from './github-delivery.checks.fixture'
import { checkRunPayload, prepareDelivery, REST_FIELDS } from './github-delivery.fixture'

const SHA = 'abc123'

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
  checkRunPayload({ ...over } as Parameters<typeof checkRunPayload>[0])

const restReading = () =>
  vi.fn(async (args: unknown) => {
    const { collectChecks } = args as {
      collectChecks?: (value: { headSha: string; checks: never[] }) => void
    }
    const rows = await db.orm.public.GithubCommitCheck.where({
      repoFullName: 'compai/app',
      headSha: SHA,
    }).all()
    const statuses = rows
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
    collectChecks?.({ headSha: SHA, checks: [...statuses, ...runs] as never })
    return { ...REST_FIELDS }
  })

const verdicts = async () => (await prEventRows()).filter((row) => row.kind === 'verdict')

describe('CI verdict sequencing', () => {
  useTestDatabase()
  beforeEach(prepareDelivery)

  it('settles a head that carries only commit statuses once', async () => {
    const readPullRequest = restReading()
    const { service } = await setupTrackedPr(readPullRequest as never)

    await service.handle({ event: 'status', payload: statusPayload })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })

  it('announces nothing while a check run is in progress, then exactly one green', async () => {
    const readPullRequest = restReading()
    const { service } = await setupTrackedPr(readPullRequest as never)

    await service.handle({ event: 'check_run', payload: runPayload({ id: 11, ...RUNNING }) })
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await verdicts()).toHaveLength(0)

    await service.handle({ event: 'check_run', payload: runPayload({ id: 11 }) })
    expect(readPullRequest).toHaveBeenCalledTimes(1)

    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })

  it('announces green, failed, green across re-runs with distinct keys, and replays quietly', async () => {
    const { service } = await setupTrackedPr(restReading() as never)
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
