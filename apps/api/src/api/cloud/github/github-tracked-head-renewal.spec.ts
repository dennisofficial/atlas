import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeHeadReads,
  preparePollSweeper,
  seedTarget,
  serviceWith,
  trackHead,
} from './github-poll-sweeper.fixture'

describe('tracked head renewal', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('renews only the targets of the owner whose live session tracks the head', async () => {
    const head = fakeHeadReads()
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await trackHead({ sessionId: 'ses_tracked', branch: 'dennis/feature' })
    const near = new Date(Date.now() + 60_000)
    const own = await seedTarget({ liveUntil: near })
    const other = await seedTarget({ userId: 'usr_2', liveUntil: near })

    await service.handlePoll()

    expect(
      (await db.orm.public.GithubTrackingTarget.where({ id: own.id }).first())?.liveUntil.getTime(),
    ).toBeGreaterThan(near.getTime() + 60_000)
    expect(
      (
        await db.orm.public.GithubTrackingTarget.where({ id: other.id }).first()
      )?.liveUntil.getTime(),
    ).toBe(near.getTime())
  })
})
