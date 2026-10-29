import { ForbiddenException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers, USER_A, USER_B } from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

describe('ThreadsService open confined to a token family', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    service = new ThreadsService(inertSignals())
  })

  it('re-opening confined to a token family refuses a thread spawned elsewhere and writes nothing', async () => {
    const first = { type: 'user-said', body: '{}' }
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_foreign', runId: 'run_1', drafts: [first], title: 'kept' },
    })

    await expect(
      service.open({
        userId: USER_A,
        confinedTo: 'brn_root',
        draft: {
          threadId: 'brn_foreign',
          runId: 'run_2',
          drafts: [first, { type: 'user-said', body: '{"text":"injected"}' }],
          title: 'stolen',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    const stored = await service.find({ userId: USER_A, threadId: 'brn_foreign' })
    expect(stored.title).toBe('kept')
    expect(stored.head).toBe(1)
  })

  it('re-opening confined to a token family refuses a sub-agent of another root', async () => {
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_other', runId: 'run_0', drafts: [] },
    })
    await service.open({
      userId: USER_A,
      draft: {
        threadId: 'brn_cousin',
        runId: 'run_1',
        drafts: [],
        agent: { spawnedBy: 'brn_other', type: 'explore' },
      },
    })

    await expect(
      service.open({
        userId: USER_A,
        confinedTo: 'brn_root',
        draft: { threadId: 'brn_cousin', runId: 'run_2', drafts: [], title: 'stolen' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('re-opening confined to a token family refuses a grandchild of its own sub-agent', async () => {
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_root', runId: 'run_0', drafts: [] },
    })
    await service.open({
      userId: USER_A,
      draft: {
        threadId: 'brn_child',
        runId: 'run_1',
        drafts: [],
        agent: { spawnedBy: 'brn_root', type: 'explore' },
      },
    })
    await service.open({
      userId: USER_A,
      draft: {
        threadId: 'brn_grand',
        runId: 'run_2',
        drafts: [],
        agent: { spawnedBy: 'brn_child', type: 'explore' },
      },
    })

    await expect(
      service.open({
        userId: USER_A,
        confinedTo: 'brn_root',
        draft: {
          threadId: 'brn_grand',
          runId: 'run_3',
          drafts: [],
          title: 'stolen',
          agent: { spawnedBy: 'brn_root', type: 'explore' },
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("re-opening confined to a token family reaches the token's own thread", async () => {
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_root', runId: 'run_1', drafts: [] },
    })

    const reopened = await service.open({
      userId: USER_A,
      confinedTo: 'brn_root',
      draft: { threadId: 'brn_root', runId: 'run_2', drafts: [], title: 'renamed' },
    })

    expect(reopened.thread.title).toBe('renamed')
  })

  it('re-opening confined to a token family reaches its own sub-agent thread', async () => {
    const agent = { spawnedBy: 'brn_root', type: 'explore' }
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_root', runId: 'run_0', drafts: [] },
    })
    await service.open({
      userId: USER_A,
      draft: { threadId: 'brn_child', runId: 'run_1', drafts: [], agent },
    })

    const reopened = await service.open({
      userId: USER_A,
      confinedTo: 'brn_root',
      draft: { threadId: 'brn_child', runId: 'run_2', drafts: [], title: 'renamed', agent },
    })

    expect(reopened.thread.title).toBe('renamed')
  })
})
