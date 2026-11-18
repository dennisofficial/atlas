import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { preparePollSweeper } from './github-poll-sweeper.fixture'
import { TARGET_BATCH, liveTrackingTargets } from './github-refresh-targets'

const seedTarget = (args: { branch: string; attemptedAt: Date | null }) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: 'compai/app',
    branch: args.branch,
    prNumber: 0,
    lookedUpAt: null,
    attemptedAt: args.attemptedAt,
    liveUntil: new Date(Date.now() + 3_600_000),
  })

describe('live tracking target selection', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('reads unattempted heads first and then the oldest attempted ones', async () => {
    await seedTarget({ branch: 'never-0', attemptedAt: null })
    await seedTarget({ branch: 'never-1', attemptedAt: null })
    await seedTarget({ branch: 'oldest', attemptedAt: new Date(Date.now() - 600_000) })
    await seedTarget({ branch: 'newest', attemptedAt: new Date(Date.now() - 60_000) })

    const read = await liveTrackingTargets(new Date())

    expect(
      read
        .slice(0, 2)
        .map((target) => target.branch)
        .sort(),
    ).toEqual(['never-0', 'never-1'])
    expect(read.slice(2).map((target) => target.branch)).toEqual(['oldest', 'newest'])
  })

  it('caps one sweep at a batch of attempted targets, oldest first', async () => {
    for (let index = 0; index < TARGET_BATCH + 5; index += 1)
      await seedTarget({ branch: `b${index}`, attemptedAt: new Date(Date.now() - index * 1_000) })

    const read = await liveTrackingTargets(new Date())

    expect(read).toHaveLength(TARGET_BATCH)
    expect(read[0]?.branch).toBe(`b${TARGET_BATCH + 4}`)
  })

  it('skips a target whose liveUntil has passed', async () => {
    await seedTarget({ branch: 'dead', attemptedAt: null })
    await db.orm.public.GithubTrackingTarget.where({ branch: 'dead' }).update({
      liveUntil: new Date(Date.now() - 1_000),
    })

    expect(await liveTrackingTargets(new Date())).toEqual([])
  })
})
