import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import type { CheckSuiteShape } from './github-check-suites'
import {
  FILLED_PR_STATE,
  REST_FIELDS,
  SETTLING_CHECK_RUN_PAYLOAD,
  checkRunPayload,
  prepareDelivery,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import { prEventRows, seedPrState } from './testing/github-seed'

const QUEUED_WORKFLOW: CheckSuiteShape = {
  status: 'queued',
  conclusion: null,
  latest_check_runs_count: 0,
  app: { slug: 'github-actions' },
}

const runningCheck = (id: number) =>
  checkRunPayload({
    id,
    name: `migration-safety-${id}`,
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-11-02T04:30:00Z',
    completed_at: null,
  })

const passedCheck = (id: number) =>
  checkRunPayload({
    id,
    name: `migration-safety-${id}`,
    started_at: '2026-11-02T04:30:00Z',
    completed_at: '2026-11-02T04:31:00Z',
  })

const kindsOf = async (): Promise<string[]> => (await prEventRows()).map((row) => row.kind)

const confirmRows = () => db.orm.public.GithubPrOutbox.where({ kind: 'confirm-green' }).all()

const makeConfirmsDue = (args: { attempts?: number } = {}) =>
  db.orm.public.GithubPrOutbox.where({ kind: 'confirm-green', dispatchedAt: null }).updateAndCount({
    nextAttemptAt: new Date(Date.now() - 1_000),
    ...(args.attempts === undefined ? {} : { attempts: args.attempts }),
  })

const rig = async (suites: { current: readonly CheckSuiteShape[] }) => {
  const wired = serviceWith({
    tokens: { 'usr-creator': 'ghu_creator' },
    readPullRequest: async () => ({ ...REST_FIELDS, checksRunning: 0, checksPassed: 1 }),
    suites: () => suites.current,
  })
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  await seedPrState({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0 })
  return wired
}

describe('GithubDeliveryService CI starting again on an announced head', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('tells the agent once when CI runs again after a verdict, then announces the new verdict', async () => {
    const { service } = await rig({ current: [] })

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    await service.handle({ event: 'check_run', payload: runningCheck(2) })
    await service.handle({ event: 'check_run', payload: runningCheck(3) })

    expect(await kindsOf()).toEqual(['verdict', 'ci-restarted'])
    const restarted = (await prEventRows()).find((row) => row.kind === 'ci-restarted')
    expect(restarted).toMatchObject({
      userId: 'usr-a',
      payload: { headSha: 'abc123', settled: false },
    })

    await service.handle({ event: 'check_run', payload: passedCheck(2) })
    await service.handle({ event: 'check_run', payload: passedCheck(3) })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts.map((row) => row.payload)).toEqual([
      expect.objectContaining({ verdict: 'green' }),
      expect.objectContaining({ verdict: 'green' }),
    ])
  })

  it('sends no restart notice while the head never had a verdict', async () => {
    const { service } = await rig({ current: [] })

    await service.handle({ event: 'check_run', payload: runningCheck(2) })

    expect(await kindsOf()).toEqual([])
  })
})

describe('GithubDeliveryService green verdict held by a queued workflow', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('holds green while a workflow is queued and announces it once the suites clear', async () => {
    const suites = { current: [QUEUED_WORKFLOW] }
    const { service, dispatcher } = await rig(suites)

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })

    expect(await kindsOf()).toEqual([])
    expect(await confirmRows()).toEqual([expect.objectContaining({ attempts: 1 })])

    suites.current = []
    await makeConfirmsDue()
    await dispatcher.drain()

    expect(await kindsOf()).toEqual(['verdict'])
  })

  it('drops a held green once the queued workflow starts its checks', async () => {
    const suites = { current: [QUEUED_WORKFLOW] }
    const { service, dispatcher } = await rig(suites)

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    await service.handle({ event: 'check_run', payload: runningCheck(2) })
    suites.current = []
    await makeConfirmsDue()
    await dispatcher.drain()

    expect(await kindsOf()).toEqual([])

    await service.handle({ event: 'check_run', payload: passedCheck(2) })

    expect(await kindsOf()).toEqual(['verdict'])
  })

  it('announces green on the last attempt when a workflow stays queued', async () => {
    const { service, dispatcher } = await rig({ current: [QUEUED_WORKFLOW] })

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    await makeConfirmsDue({ attempts: 4 })
    await dispatcher.drain()

    expect(await kindsOf()).toEqual(['verdict'])
  })
})
