import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedEventRow, seedUsers, USER_A, USER_B } from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

describe('thread enrichment', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    service = new ThreadsService(inertSignals())
  })

  it('find carries the same worktree and pull request enrichment as list', async () => {
    const one = await service.create({
      userId: USER_A,
      draft: { workspace: '/repo', title: 'one' },
    })
    await seedEventRow({
      id: 'evt_fw1',
      threadId: one.id,
      seq: 1,
      at: new Date('2026-09-15T00:00:00.000Z'),
      type: 'worktree-entered',
      body: JSON.stringify({ path: '/repo/.atlas/worktrees/one', branch: 'dennis/one' }),
    })
    await seedEventRow({
      id: 'evt_fp1',
      threadId: one.id,
      seq: 2,
      at: new Date('2026-09-15T00:00:01.000Z'),
      type: 'pull-request-linked',
      body: JSON.stringify({
        number: 421,
        url: 'https://github.com/x/y/pull/421',
        repo: 'x/y',
        branch: 'dennis/one',
      }),
    })

    const found = await service.find({ userId: USER_A, threadId: one.id })
    const [listed] = await service.list({ userId: USER_A, project: '/repo' })

    expect(found.worktree).toEqual({ path: '/repo/.atlas/worktrees/one', branch: 'dennis/one' })
    expect(found.pullRequests?.[0]?.number).toBe(421)
    expect(found).toEqual(listed!)
  })

  it('find leaves worktree and pullRequests off a thread without them', async () => {
    const bare = await service.create({ userId: USER_A, draft: {} })

    const found = await service.find({ userId: USER_A, threadId: bare.id })

    expect(found.worktree).toBeUndefined()
    expect(found.pullRequests).toBeUndefined()
  })
})
