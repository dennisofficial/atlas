import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { prEventRows, seedPrState } from '../../../../test/github-seed'
import type { BranchProtectionRead } from './github-branch-protection'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { GithubUserReads } from './github-user-reads'
import {
  checkRunPayload,
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'

const STATUS_PAYLOAD = (state: string) => ({
  id: 9,
  sha: 'abc123',
  context: 'Vercel – atlas-storybook',
  state,
  created_at: '2026-11-17T20:47:10Z',
  updated_at: '2026-11-17T20:47:10Z',
  repository: { full_name: 'compai/app' },
})

const CI_RUNNING = checkRunPayload({
  id: 77,
  name: 'ci',
  status: 'in_progress',
  conclusion: null,
  started_at: '2026-11-17T20:47:14Z',
  completed_at: null,
})

const CI_COMPLETED = checkRunPayload({
  id: 77,
  name: 'ci',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-17T20:47:14Z',
  completed_at: '2026-11-17T20:52:30Z',
})

const STORYBOOK_SUCCEEDED = {
  ...REST_FIELDS,
  checksRunning: 0,
  checksPassed: 1,
  checksFailed: 0,
}

const requireContexts = (fields: PullRequestCacheFields, requiredContexts: string[] | null) =>
  (async (input: {
    collectRequiredContexts?: (protection: BranchProtectionRead) => void
  }): Promise<PullRequestCacheFields> => {
    input.collectRequiredContexts?.({
      acquiredAt: new Date(),
      baseBranch: 'main',
      requiredContexts,
    })
    return fields
  }) as GithubUserReads['readPullRequest']

const storedState = async () => (await db.orm.public.GithubPrState.all())[0]

const lastFanout = async () =>
  (await db.orm.public.GithubPrOutbox.all()).filter((row) => row.kind === 'fanout').at(-1)

const verdictRows = async () => (await prEventRows()).filter((row) => row.kind === 'verdict')

describe('required status checks gate the head verdict', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it("stores the fill's required contexts so the head reports expected until it reports", async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: requireContexts(STORYBOOK_SUCCEEDED, ['ci']),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await service.handle({ event: 'status', payload: STATUS_PAYLOAD('success') })

    const brought = await db.orm.public.GithubBranchProtection.all()
    expect(brought).toMatchObject([{ requiredContexts: ['ci'] }])
    expect((await storedState())?.checksState).toBe('expected')
    expect((await lastFanout())?.payload).toMatchObject({ state: { checksState: 'expected' } })
    expect(await verdictRows()).toHaveLength(0)

    await service.handle({ event: 'check_run', payload: CI_RUNNING })
    expect((await storedState())?.checksState).toBe('pending')
    expect(await verdictRows()).toHaveLength(0)

    await service.handle({ event: 'check_run', payload: CI_COMPLETED })
    expect((await storedState())?.checksState).toBe('success')
    const verdicts = await verdictRows()
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr-a',
      payload: { verdict: 'green', headSha: 'abc123', settled: true },
    })
  })

  it('settles on the observed tally when the base branch requires nothing', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: requireContexts(STORYBOOK_SUCCEEDED, []),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await service.handle({ event: 'status', payload: STATUS_PAYLOAD('success') })

    expect((await storedState())?.checksState).toBe('success')
    const verdicts = await verdictRows()
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })

  it('calls a green PR mergeable only when GitHub reports a clean merge state', async () => {
    const blocked = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 3,
        mergeClean: false,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await blocked.service.handle({ event: 'check_run', payload: checkRunPayload() })

    const withheld = await verdictRows()
    expect(withheld).toHaveLength(1)
    expect(withheld[0]?.payload).not.toHaveProperty('mergeable')

    await seedPrState({
      ...FILLED_PR_STATE,
      prNumber: 43,
      checksRunning: 0,
      checksPassed: 0,
    })
    await seedSubscription({ userId: 'usr-a', prNumber: 43 })
    const clean = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 3,
        mergeClean: true,
      }),
    })

    await clean.service.handle({ event: 'check_run', payload: checkRunPayload() })

    const announced = (await verdictRows()).filter((row) => row.prNumber === 43)
    expect(announced).toHaveLength(1)
    expect(announced[0]?.payload).toMatchObject({ verdict: 'green', mergeable: true })
  })
})
