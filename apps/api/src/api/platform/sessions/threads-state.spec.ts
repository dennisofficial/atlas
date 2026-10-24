import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedPrState } from '../../../../test/github-seed'
import {
  seedEventRow,
  seedThreadRow,
  seedUsers,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { ThreadsService } from './threads.service'

const PINNED = new Date('2026-09-16T10:00:00.000Z')
const ARCHIVED = new Date('2026-09-17T10:00:00.000Z')

const linkPullRequest = (args: { threadId: string; seq: number; repo: string; number: number }) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'pull-request-linked',
    body: JSON.stringify({
      number: args.number,
      url: `https://github.com/${args.repo}/pull/${args.number}`,
      repo: args.repo,
      branch: 'dennis/one',
    }),
  })

describe('ThreadsService thread state reads', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await db.orm.public.Project.create({ id: 'prj_a', name: 'a', ownerUserId: USER_A })
    await db.orm.public.Project.create({ id: 'prj_b', name: 'b', ownerUserId: USER_A })
    service = new ThreadsService()
  })

  it('reports null pinnedAt and archivedAt for a thread that is neither', async () => {
    await seedThreadRow({ id: 'brn_plain', projectId: 'prj_a' })

    const [thread] = await service.list({ userId: USER_A, projectId: 'prj_a' })

    expect(thread?.pinnedAt).toBeNull()
    expect(thread?.archivedAt).toBeNull()
  })

  it('reports pinnedAt and archivedAt as ISO strings', async () => {
    await seedThreadRow({
      id: 'brn_state',
      projectId: 'prj_a',
      pinnedAt: PINNED,
      archivedAt: ARCHIVED,
    })

    const found = await service.find({ userId: USER_A, threadId: 'brn_state' })

    expect(found.pinnedAt).toBe(PINNED.toISOString())
    expect(found.archivedAt).toBe(ARCHIVED.toISOString())
  })

  it('lists by projectId, scoped to the user, newest first', async () => {
    await seedThreadRow({
      id: 'brn_old',
      projectId: 'prj_a',
      updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    })
    await seedThreadRow({
      id: 'brn_new',
      projectId: 'prj_a',
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    })
    await seedThreadRow({ id: 'brn_elsewhere', projectId: 'prj_b' })
    await seedThreadRow({ id: 'brn_unfiled', workspace: 'prj_a' })
    await seedThreadRow({ id: 'brn_theirs', projectId: 'prj_a', userId: USER_B })

    const listed = await service.list({ userId: USER_A, projectId: 'prj_a' })

    expect(listed.map((thread) => thread.id)).toEqual(['brn_new', 'brn_old'])
  })

  it('honours the limit when listing by projectId', async () => {
    await seedThreadRow({ id: 'brn_1', projectId: 'prj_a' })
    await seedThreadRow({ id: 'brn_2', projectId: 'prj_a' })

    const listed = await service.list({ userId: USER_A, projectId: 'prj_a', limit: 1 })

    expect(listed).toHaveLength(1)
  })

  it('enriches linked pull requests with the live GithubPrState state', async () => {
    await seedThreadRow({ id: 'brn_pr', projectId: 'prj_a' })
    await linkPullRequest({ threadId: 'brn_pr', seq: 1, repo: 'compai/app', number: 42 })
    await linkPullRequest({ threadId: 'brn_pr', seq: 2, repo: 'compai/app', number: 43 })
    await linkPullRequest({ threadId: 'brn_pr', seq: 3, repo: 'compai/other', number: 42 })
    await seedPrState({ repoFullName: 'compai/app', prNumber: 42, state: 'merged' })
    await seedPrState({ repoFullName: 'compai/other', prNumber: 42, state: 'closed' })

    const [thread] = await service.list({ userId: USER_A, projectId: 'prj_a' })

    expect(thread?.pullRequests?.map((pr) => [pr.repo, pr.number, pr.state])).toEqual([
      ['compai/app', 42, 'merged'],
      ['compai/app', 43, undefined],
      ['compai/other', 42, 'closed'],
    ])
  })

  it('enriches pull requests on the legacy project listing too', async () => {
    await seedThreadRow({ id: 'brn_legacy', workspace: '/repo' })
    await linkPullRequest({ threadId: 'brn_legacy', seq: 1, repo: 'compai/app', number: 42 })
    await seedPrState({ repoFullName: 'compai/app', prNumber: 42, state: 'open' })

    const [thread] = await service.list({ userId: USER_A, project: '/repo' })

    expect(thread?.pullRequests?.[0]?.state).toBe('open')
  })
})
