import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows, seedPrState } from '../../../../test/github-seed'
import {
  checkRunPayload,
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import { RUNNING } from './github-delivery.checks.fixture'
import { checkRunInputOf } from './github-commit-checks'
import type { GithubUserReads } from './github-user-reads'

type Annotations = Awaited<ReturnType<GithubUserReads['readCheckAnnotations']>>

const RAW: Annotations = [
  { path: 'src/a.ts', start_line: 12, annotation_level: 'failure', message: 'Type error' },
  { annotation_level: 'failure', message: 'Process completed with exit code 1.' },
  { annotation_level: 'notice', message: 'runner notice' },
  { annotation_level: 'failure', message: 'one or more CI checks did not pass' },
]

const failingRun = (output: { annotations_count: number | null } = { annotations_count: 2 }) => {
  const base = checkRunPayload({ id: 7, name: 'typecheck', conclusion: 'failure' })
  return {
    ...base,
    check_run: {
      ...base.check_run,
      app: { slug: 'github-actions' },
      output: { title: null, summary: null, ...output },
    },
  }
}

const setup = async (readCheckAnnotations: GithubUserReads['readCheckAnnotations']) => {
  const { service } = serviceWith({
    tokens: { 'usr-creator': 'ghu_creator' },
    readPullRequest: vi.fn(async (..._args: unknown[]) => REST_FIELDS),
    readCheckAnnotations,
  })
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0, mergeable: null })
  await service.handle({
    event: 'check_run',
    payload: checkRunPayload({ id: 1, name: 'build', ...RUNNING }),
  })
  return service
}

const failedChecksOfVerdicts = async () =>
  (await prEventRows())
    .filter((event) => event.kind === 'verdict')
    .map((event) => (event.payload as { failedChecks?: unknown }).failedChecks)

describe('failure annotations on a failed check', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('fetches once and puts the filtered annotations on the verdict', async () => {
    const read = vi.fn(async (..._args: unknown[]) => RAW)
    const service = await setup(read as unknown as GithubUserReads['readCheckAnnotations'])

    await service.handle({ event: 'check_run', payload: failingRun() })

    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      owner: 'compai',
      repo: 'app',
      checkRunId: 7,
      token: 'ghu_creator',
      source: 'check-annotations',
    })
    expect(await failedChecksOfVerdicts()).toEqual([
      [
        {
          name: 'typecheck',
          app: 'github-actions',
          checkRunId: '7',
          conclusion: 'failure',
          annotations: [
            { path: 'src/a.ts', line: 12, message: 'Type error' },
            { message: 'one or more CI checks did not pass' },
          ],
        },
      ],
    ])
  })

  it('does not refetch when the same run is delivered again', async () => {
    const read = vi.fn(async (..._args: unknown[]) => RAW)
    const service = await setup(read as unknown as GithubUserReads['readCheckAnnotations'])

    await service.handle({ event: 'check_run', payload: failingRun() })
    await service.handle({ event: 'check_run', payload: failingRun() })

    expect(read).toHaveBeenCalledTimes(1)
    const row = await db.orm.public.GithubCommitCheck.where({ checkKey: 'run:7' }).first()
    expect(row?.annotationsCount).toBe(2)
    expect(row?.annotations).toHaveLength(2)
  })

  it('stores an empty list when nothing survives so the run is never refetched', async () => {
    const read = vi.fn(async (..._args: unknown[]) => [
      { annotation_level: 'failure', message: 'Process completed with exit code 1.' },
    ])
    const service = await setup(read as unknown as GithubUserReads['readCheckAnnotations'])

    await service.handle({ event: 'check_run', payload: failingRun() })
    await service.handle({ event: 'check_run', payload: failingRun() })

    expect(read).toHaveBeenCalledTimes(1)
    const row = await db.orm.public.GithubCommitCheck.where({ checkKey: 'run:7' }).first()
    expect(row?.annotations).toEqual([])
  })

  it('still records the verdict when the fetch fails', async () => {
    const read = vi.fn(async (..._args: unknown[]): Promise<Annotations> => {
      throw new Error('github down')
    })
    const service = await setup(read as unknown as GithubUserReads['readCheckAnnotations'])

    await service.handle({ event: 'check_run', payload: failingRun() })

    expect(await failedChecksOfVerdicts()).toEqual([
      [{ name: 'typecheck', app: 'github-actions', checkRunId: '7', conclusion: 'failure' }],
    ])
  })

  it('does not fetch for a run without annotations or a passing run', async () => {
    const read = vi.fn(async (..._args: unknown[]) => RAW)
    const service = await setup(read as unknown as GithubUserReads['readCheckAnnotations'])

    await service.handle({ event: 'check_run', payload: failingRun({ annotations_count: 0 }) })
    await service.handle({
      event: 'check_run',
      payload: { ...checkRunPayload({ id: 8, name: 'lint' }) },
    })

    expect(read).not.toHaveBeenCalled()
  })

  it('fetches annotations that only the REST fill reports and keeps the conclusion', async () => {
    const read = vi.fn(async (..._args: unknown[]) => RAW)
    const webhook = failingRun({ annotations_count: 0 })
    const cancelled = {
      ...webhook,
      check_run: { ...webhook.check_run, conclusion: 'cancelled' },
    }
    const readPullRequest = vi.fn(
      async (args: Parameters<GithubUserReads['readPullRequest']>[0]) => {
        args.collectChecks?.({
          headSha: 'abc123',
          checks: [
            checkRunInputOf({
              ...cancelled.check_run,
              output: { title: null, summary: null, annotations_count: 4 },
            }),
          ],
        })
        return REST_FIELDS
      },
    )
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
      readCheckAnnotations: read as unknown as GithubUserReads['readCheckAnnotations'],
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0, mergeable: null })

    await service.handle({ event: 'check_run', payload: cancelled })

    expect(read).toHaveBeenCalledTimes(1)
    expect(await failedChecksOfVerdicts()).toContainEqual([
      {
        name: 'typecheck',
        app: 'github-actions',
        checkRunId: '7',
        conclusion: 'cancelled',
        annotations: [
          { path: 'src/a.ts', line: 12, message: 'Type error' },
          { message: 'one or more CI checks did not pass' },
        ],
      },
    ])
  })
})
