import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { seedEventRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { threadsPullRequests, threadWorktrees } from './places'
import { spawnedPullRequestsByThread } from './spawned-pull-requests'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

const pullRequestBody = (number: number) =>
  JSON.stringify({
    number,
    url: `https://github.com/x/y/pull/${number}`,
    repo: 'x/y',
    branch: `branch-${number}`,
  })

const linkPullRequest = (args: { threadId: string; seq: number; number: number }) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'pull-request-linked',
    body: pullRequestBody(args.number),
  })

const enterWorktree = (args: { threadId: string; seq: number; name: string }) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'worktree-entered',
    body: JSON.stringify({ path: `/wt/${args.name}`, branch: args.name }),
  })

async function seedMixed(): Promise<string[]> {
  await seedThreadRow({ id: 'plain' })
  await seedThreadRow({ id: 'own' })
  await enterWorktree({ threadId: 'own', seq: 1, name: 'own-a' })
  await linkPullRequest({ threadId: 'own', seq: 2, number: 1 })
  await seedThreadRow({ id: 'exited' })
  await enterWorktree({ threadId: 'exited', seq: 1, name: 'gone' })
  await seedEventRow({
    threadId: 'exited',
    seq: 2,
    type: 'worktree-exited',
    body: '{}',
  })
  await seedThreadRow({ id: 'base' })
  await enterWorktree({ threadId: 'base', seq: 1, name: 'base-a' })
  await enterWorktree({ threadId: 'base', seq: 5, name: 'base-late' })
  await linkPullRequest({ threadId: 'base', seq: 2, number: 2 })
  await linkPullRequest({ threadId: 'base', seq: 6, number: 3 })
  await seedThreadRow({
    id: 'fork',
    parentThreadId: 'base',
    forkSeq: 3,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'fork2',
    parentThreadId: 'fork',
    forkSeq: 2,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'copy',
    parentThreadId: 'base',
    forkSeq: 3,
    forkMode: 'copy',
  })
  await seedThreadRow({ id: 'parent', workspace: '/repo' })
  await linkPullRequest({ threadId: 'parent', seq: 1, number: 7 })
  await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent', title: 'mate' })
  await linkPullRequest({ threadId: 'mate', seq: 1, number: 7 })
  await linkPullRequest({ threadId: 'mate', seq: 2, number: 8 })
  await seedThreadRow({ id: 'grand', spawnerThreadId: 'mate' })
  await linkPullRequest({ threadId: 'grand', seq: 1, number: 9 })
  return ['plain', 'own', 'exited', 'base', 'fork', 'fork2', 'copy', 'parent', 'mate', 'grand']
}

const oneByOne = async <T>(
  ids: string[],
  read: (args: { reader: typeof db; threadIds: string[] }) => Promise<Map<string, T>>,
) => {
  const merged = new Map<string, T>()
  for (const id of ids) {
    const single = await read({ reader: db, threadIds: [id] })
    for (const [key, value] of single) merged.set(key, value)
  }
  return merged
}

describe('batched thread enrichment', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('matches the one-thread-at-a-time result on a mixed fixture', async () => {
    const ids = await seedMixed()

    const worktrees = await threadWorktrees({ reader: db, threadIds: ids })
    const pullRequests = await threadsPullRequests({
      reader: db,
      threadIds: ids,
    })
    const spawned = await spawnedPullRequestsByThread({
      reader: db,
      threadIds: ids,
    })

    expect(worktrees).toEqual(await oneByOne(ids, threadWorktrees))
    expect(pullRequests).toEqual(await oneByOne(ids, threadsPullRequests))
    expect(spawned).toEqual(await oneByOne(ids, spawnedPullRequestsByThread))
  })

  it('resolves reference forks against the fork point', async () => {
    const ids = await seedMixed()

    const worktrees = await threadWorktrees({ reader: db, threadIds: ids })
    const pullRequests = await threadsPullRequests({
      reader: db,
      threadIds: ids,
    })
    const spawned = await spawnedPullRequestsByThread({
      reader: db,
      threadIds: ids,
    })

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
    expect(pullRequests.get('base')?.map((pr) => pr.number)).toEqual([2, 3])
    expect(spawned.get('parent')?.map((pr) => pr.number)).toEqual([7, 8, 9])
    expect(spawned.get('mate')?.map((pr) => pr.number)).toEqual([9])
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

  const seedMany = async (count: number) => {
    const ids: string[] = []
    for (let index = 0; index < count; index += 1) {
      const id = `t${index}`
      await seedThreadRow({ id })
      await enterWorktree({ threadId: id, seq: 1, name: id })
      await linkPullRequest({ threadId: id, seq: 2, number: index + 1 })
      await seedThreadRow({
        id: `f${index}`,
        parentThreadId: id,
        forkSeq: 2,
        forkMode: 'reference',
      })
      await seedThreadRow({ id: `m${index}`, spawnerThreadId: id })
      await linkPullRequest({
        threadId: `m${index}`,
        seq: 1,
        number: 100 + index,
      })
      ids.push(id, `f${index}`)
    }
    return ids
  }

  const countQueries = async (read: () => Promise<unknown>): Promise<number> => {
    const pool = (await import('@dltech/atlas-db')).sharedPool()
    const query = spyOn(pool, 'query')
    const connect = spyOn(pool, 'connect')
    await read()
    const total = query.mock.calls.length + connect.mock.calls.length
    query.mockRestore()
    connect.mockRestore()
    return total
  }

  it('issues the same number of queries for 1 thread as for 20', async () => {
    const ids = await seedMany(20)
    const read = (threadIds: string[]) => async () => {
      await threadWorktrees({ reader: db, threadIds })
      await threadsPullRequests({ reader: db, threadIds })
      await spawnedPullRequestsByThread({ reader: db, threadIds })
    }

    const one = await countQueries(read(ids.slice(0, 1)))
    const twenty = await countQueries(read(ids.filter((id) => id.startsWith('t')).slice(0, 20)))

    expect(one).toBeGreaterThan(0)
    expect(twenty).toBe(one)
  })
})
