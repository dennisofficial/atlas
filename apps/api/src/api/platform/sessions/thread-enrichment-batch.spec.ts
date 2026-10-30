import { db, sharedPool } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { REFERENCE_CHAIN_LIMIT } from './fork-chain'
import { threadsPullRequests, threadWorktrees } from './places'
import { spawnedPullRequestsByThread } from './spawned-pull-requests'
import {
  referenceSpawnedPullRequests,
  referenceThreadPullRequests,
  referenceThreadWorktree,
} from './thread-enrichment-reference.fixture'
import {
  enterWorktree,
  linkPullRequest,
  seedChain,
  seedEdges,
  seedMixed,
} from './thread-enrichment-seeds.fixture'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

const referenceResults = async (ids: string[]) => {
  const worktrees = new Map<string, Awaited<ReturnType<typeof referenceThreadWorktree>>>()
  const pullRequests = new Map<string, Awaited<ReturnType<typeof referenceThreadPullRequests>>>()
  const spawned = new Map<string, Awaited<ReturnType<typeof referenceSpawnedPullRequests>>>()
  for (const threadId of new Set(ids)) {
    worktrees.set(threadId, await referenceThreadWorktree({ reader: db, threadId }))
    pullRequests.set(threadId, await referenceThreadPullRequests({ reader: db, threadId }))
    spawned.set(threadId, await referenceSpawnedPullRequests({ reader: db, threadId }))
  }
  return { worktrees, pullRequests, spawned }
}

const batchedResults = async (threadIds: string[]) => ({
  worktrees: await threadWorktrees({ reader: db, threadIds }),
  pullRequests: await threadsPullRequests({ reader: db, threadIds }),
  spawned: await spawnedPullRequestsByThread({ reader: db, threadIds }),
})

describe('batched thread enrichment', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('matches the pre-batching per-thread implementation on a mixed fixture', async () => {
    const ids = [...(await seedMixed()), ...(await seedEdges())]

    expect(await batchedResults(ids)).toEqual(await referenceResults(ids))
  })

  it('matches the reference when the input repeats thread ids', async () => {
    const ids = await seedMixed()
    const repeated = [...ids, ...ids.slice(3), 'fork2', 'fork2']

    expect(await batchedResults(repeated)).toEqual(await referenceResults(repeated))
    expect((await batchedResults(repeated)).pullRequests.size).toBe(ids.length)
  })

  it('reaches events at the reference chain limit and falls back one hop past it', async () => {
    const limit = await seedChain({
      prefix: 'lim',
      links: REFERENCE_CHAIN_LIMIT,
    })
    const over = await seedChain({
      prefix: 'over',
      links: REFERENCE_CHAIN_LIMIT + 1,
    })

    const batched = await batchedResults([limit, over])

    expect(batched.worktrees.get(limit)).toEqual({
      path: '/wt/lim',
      branch: 'lim',
    })
    expect(batched.pullRequests.get(limit)?.map((pr) => pr.number)).toEqual([50])
    expect(batched.worktrees.get(over)).toBeNull()
    expect(batched.pullRequests.get(over)).toEqual([])
    expect(batched).toEqual(await referenceResults([limit, over]))
  })

  it('falls back on a reference cycle instead of looping', async () => {
    await seedEdges()

    const batched = await batchedResults(['cycA', 'cycB'])

    expect(batched.worktrees.get('cycA')).toBeNull()
    expect(batched.pullRequests.get('cycB')).toEqual([])
    expect(batched).toEqual(await referenceResults(['cycA', 'cycB']))
  })

  it('keeps the smaller bound when an inner fork point exceeds the outer one', async () => {
    await seedEdges()

    const batched = await batchedResults(['tip', 'mid'])

    expect(batched.worktrees.get('tip')).toEqual({
      path: '/wt/trunk-a',
      branch: 'trunk-a',
    })
    expect(batched.pullRequests.get('tip')?.map((pr) => pr.number)).toEqual([20])
    expect(batched).toEqual(await referenceResults(['tip', 'mid']))
  })

  it("lets a fork's own events hide its parent's", async () => {
    await seedEdges()

    const batched = await batchedResults(['hider', 'hiderChild'])

    expect(batched.worktrees.get('hider')).toEqual({
      path: '/wt/hider-own',
      branch: 'hider-own',
    })
    expect(batched.pullRequests.get('hider')?.map((pr) => pr.number)).toEqual([30])
    expect(batched.pullRequests.get('hiderChild')?.map((pr) => pr.number)).toEqual([30])
    expect(batched).toEqual(await referenceResults(['hider', 'hiderChild']))
  })

  it('resolves reference forks against the fork point', async () => {
    const ids = await seedMixed()

    const { worktrees, pullRequests, spawned } = await batchedResults(ids)

    expect(worktrees.get('plain')).toBeNull()
    expect(worktrees.get('exited')).toBeNull()
    expect(worktrees.get('fork')).toEqual({
      path: '/wt/base-a',
      branch: 'base-a',
    })
    expect(worktrees.get('fork2')).toEqual({
      path: '/wt/base-a',
      branch: 'base-a',
    })
    expect(worktrees.get('copy')).toBeNull()
    expect(pullRequests.get('fork')?.map((pr) => pr.number)).toEqual([2])
    expect(pullRequests.get('fork2')?.map((pr) => pr.number)).toEqual([2])
    expect(pullRequests.get('base')?.map((pr) => pr.number)).toEqual([2, 3])
    expect(spawned.get('parent')?.map((pr) => pr.number)).toEqual([7, 8, 9])
    expect(spawned.get('mate')?.map((pr) => pr.number)).toEqual([9])
  })

  it('does not share one fallback array between threads', async () => {
    await seedThreadRow({ id: 'a' })
    await seedThreadRow({ id: 'b' })

    const { pullRequests } = await batchedResults(['a', 'b'])
    pullRequests.get('a')?.push({ number: 1, url: 'u', repo: 'r', branch: 'b' })

    expect(pullRequests.get('b')).toEqual([])
  })

  it('lists and finds identical threads and drops a spawned duplicate of an own pull request', async () => {
    await seedMixed()
    const service = new ThreadsService(inertSignals())

    const listed = await service.list({ userId: USER_A, project: '/repo' })
    const parent = listed.find((thread) => thread.id === 'parent')
    const found = await service.find({ userId: USER_A, threadId: 'parent' })

    expect(found).toEqual(parent!)
    expect(found.pullRequests?.map((pr) => [pr.number, pr.via?.threadId])).toEqual([
      [7, undefined],
      [8, 'mate'],
      [9, 'grand'],
    ])
  })

  const seedGroup = async (index: number) => {
    const id = `t${index}`
    await seedThreadRow({ id, workspace: '/repo' })
    await enterWorktree({ threadId: id, seq: 1, name: id })
    await linkPullRequest({ threadId: id, seq: 2, number: index + 1 })
    await seedThreadRow({
      id: `f${index}`,
      workspace: '/repo',
      parentThreadId: id,
      forkSeq: 2,
      forkMode: 'reference',
    })
    await seedThreadRow({
      id: `m${index}`,
      workspace: '/repo',
      spawnerThreadId: id,
    })
    await linkPullRequest({
      threadId: `m${index}`,
      seq: 1,
      number: 100 + index,
    })
  }

  const countQueries = async (read: () => Promise<unknown>): Promise<number> => {
    const pool = sharedPool()
    const query = spyOn(pool, 'query')
    const connect = spyOn(pool, 'connect')
    await read()
    const total = query.mock.calls.length + connect.mock.calls.length
    query.mockRestore()
    connect.mockRestore()
    return total
  }

  it('issues the same number of queries listing 1 thread group as listing 20', async () => {
    const service = new ThreadsService(inertSignals())
    const list = (limit: number) => async () => {
      const listed = await service.list({
        userId: USER_A,
        project: '/repo',
        limit,
      })
      return listed
    }

    await seedGroup(0)
    const one = await countQueries(list(100))
    for (let index = 1; index < 20; index += 1) await seedGroup(index)
    const listedCount = (await service.list({ userId: USER_A, project: '/repo', limit: 100 }))
      .length
    const twenty = await countQueries(list(100))

    expect(listedCount).toBe(60)
    expect(one).toBeGreaterThan(0)
    expect(twenty).toBe(one)
  })
})
