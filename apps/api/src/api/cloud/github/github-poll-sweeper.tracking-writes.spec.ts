import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  covered,
  fakeHeadReads,
  preparePollSweeper,
  REST_PULL,
  seedTarget,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService tracked-head writes', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('creates one row when two sweeps discover the same head pull request at once', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const served = head.pullsByHead.getMockImplementation()
    const arrivals = { count: 0, release: (): void => {} }
    const bothArrived = new Promise<void>((resolve) => {
      arrivals.release = resolve
    })
    head.pullsByHead.mockImplementation(async (input) => {
      arrivals.count += 1
      if (arrivals.count === 2) arrivals.release()
      await bothArrived
      return served === undefined ? [] : await served(input)
    })
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1', usr_2: 'ghu_2' },
      headReads: head.reads,
    })
    await covered()
    await seedTarget()
    await seedTarget({ userId: 'usr_2' })

    await Promise.all([service.handlePoll({ limit: 1 }), service.handlePoll({ limit: 1 })])

    expect(arrivals.count).toBe(2)
    const rows = await db.orm.public.GithubPrState.where({ repoFullName: 'compai/app' }).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe(1)
  })

  it('never writes a delivery or inbox row for a tracked head', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget()

    await service.handlePoll()

    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
  })
})
