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
    let arrived = 0
    let release = (): void => {}
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    head.pullsByHead.mockImplementation(async (input) => {
      arrived += 1
      if (arrived === 2) release()
      await Promise.race([bothArrived, new Promise((resolve) => setTimeout(resolve, 500))])
      return served === undefined ? [] : await served(input)
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await covered()
    await seedTarget()

    await Promise.all([service.handlePoll(), service.handlePoll()])

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
