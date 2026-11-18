import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  covered,
  preparePollSweeper,
  REST_FIELDS,
  seedTarget,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService target seeding', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('seeds a numbered target on an app-covered repo with one read', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await covered()
    const target = await seedTarget({ kind: 'pull-request', prNumber: 9, branch: '' })

    await service.handlePoll()
    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    const row = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(row?.lookedUpAt).not.toBeNull()
  })
})
