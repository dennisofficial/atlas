import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
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

const requireContext = (contexts: string[]) =>
  db.orm.public.GithubBranchProtection.create({
    repoFullName: 'compai/app',
    baseBranch: 'main',
    requiredContexts: contexts,
    fetchedAt: new Date(),
  })

const verdictRows = async () => (await prEventRows()).filter((row) => row.kind === 'verdict')

describe('required status checks gate the head verdict', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('withholds the verdict until the required check has reported on the head', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => STORYBOOK_SUCCEEDED,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await requireContext(['ci'])
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await service.handle({ event: 'status', payload: STATUS_PAYLOAD('success') })
    expect(await verdictRows()).toHaveLength(0)

    await service.handle({ event: 'check_run', payload: CI_RUNNING })
    expect(await verdictRows()).toHaveLength(0)

    await service.handle({ event: 'check_run', payload: CI_COMPLETED })
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
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 1,
        checksFailed: 0,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await service.handle({ event: 'status', payload: STATUS_PAYLOAD('success') })

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
