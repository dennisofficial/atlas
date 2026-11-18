import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService stale fills', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('keeps a merge that lands while the poll is reading', async () => {
    const readPullRequest = vi.fn(async () => {
      await db.orm.public.GithubPrState.where({
        repoFullName: 'compai/app',
        prNumber: 7,
      }).update({ state: 'merged', version: 1 })
      return { ...REST_FIELDS, state: 'open' }
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ prNumber: 7, branch: '#7' })
    await seedPrState({ prNumber: 7, state: 'open', updatedAt: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    const row = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(row?.state).toBe('merged')
  })
})
