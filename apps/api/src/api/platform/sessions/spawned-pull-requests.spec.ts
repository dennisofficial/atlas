import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedEventRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

const linkPullRequest = async (args: {
  threadId: string
  seq: number
  number: number
  repo?: string
}) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'pull-request-linked',
    body: JSON.stringify({
      number: args.number,
      url: `https://github.com/x/y/pull/${args.number}`,
      repo: args.repo ?? 'x/y',
      branch: `branch-${args.number}`,
    }),
  })

describe('spawned pull requests', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A)
    service = new ThreadsService(inertSignals())
  })

  it('adds a teammate pull request carrying via after the own ones', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent', title: 'fix the bug' })
    await linkPullRequest({ threadId: 'parent', seq: 1, number: 1 })
    await linkPullRequest({ threadId: 'mate', seq: 1, number: 2 })

    const found = await service.find({ userId: USER_A, threadId: 'parent' })

    expect(found.pullRequests?.map((pr) => pr.number)).toEqual([1, 2])
    expect(found.pullRequests?.[0]?.via).toBeUndefined()
    expect(found.pullRequests?.[1]?.via).toEqual({ threadId: 'mate', title: 'fix the bug' })
  })

  it('lists a pull request once without via when the parent also owns it', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent' })
    await linkPullRequest({ threadId: 'parent', seq: 1, number: 7 })
    await linkPullRequest({ threadId: 'mate', seq: 1, number: 7 })

    const found = await service.find({ userId: USER_A, threadId: 'parent' })

    expect(found.pullRequests).toHaveLength(1)
    expect(found.pullRequests?.[0]?.via).toBeUndefined()
  })

  it('includes a grandchild pull request with a null title when untitled', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent' })
    await seedThreadRow({ id: 'grandchild', spawnerThreadId: 'mate' })
    await linkPullRequest({ threadId: 'grandchild', seq: 1, number: 9 })

    const found = await service.find({ userId: USER_A, threadId: 'parent' })

    expect(found.pullRequests?.[0]?.via).toEqual({ threadId: 'grandchild', title: null })
  })

  it('does not attribute a parent pull request to the teammate', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent' })
    await linkPullRequest({ threadId: 'parent', seq: 1, number: 1 })

    const found = await service.find({ userId: USER_A, threadId: 'mate' })

    expect(found.pullRequests).toBeUndefined()
  })
})
