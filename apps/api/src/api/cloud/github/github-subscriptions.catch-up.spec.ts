import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubUserReads } from './github-user-reads'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import type { GithubService } from './github.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'

const fake = fakeGithubDb()

const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
}

const subscribe = { userId: 'usr_1', repoFullName: 'compai/app', branch: 'dennis/add-the-thing' }

function serviceWith(args: {
  readPullRequest: GithubUserReads['readPullRequest']
  findOpenPrForBranch: GithubUserReads['findOpenPrForBranch']
}): GithubSubscriptionsService {
  const github = { findToken: async () => 'ghu_1' } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => 'created' as const),
  } as unknown as GithubHookLifecycleService
  const reads = {
    readPullRequest: args.readPullRequest,
    findOpenPrForBranch: args.findOpenPrForBranch,
  } as unknown as GithubUserReads
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
  return new GithubSubscriptionsService(github, reads, hooks)
}

describe('GithubSubscriptionsService branch catch-up', () => {
  beforeEach(() => fake.reset())
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    { mergedState: 'merged', mergeable: false },
    { mergedState: 'closed', mergeable: false },
  ])(
    're-subscribing after the remembered pull request $mergedState keeps its number and exact state',
    async ({ mergedState, mergeable }) => {
      const findOpenPrForBranch = vi
        .fn<GithubUserReads['findOpenPrForBranch']>()
        .mockResolvedValueOnce({ number: 42 })
        .mockResolvedValue(null)
      const readPullRequest = vi
        .fn<GithubUserReads['readPullRequest']>()
        .mockResolvedValueOnce(REST_FIELDS)
        .mockResolvedValue({ ...REST_FIELDS, state: mergedState, mergeable })
      const service = serviceWith({ findOpenPrForBranch, readPullRequest })

      const first = await service.subscribe(subscribe)
      const second = await service.subscribe(subscribe)

      expect(fake.subscriptions).toHaveLength(1)
      expect(second.id).toBe(first.id)
      expect(second.prNumber).toBe(42)
      expect(second.state).toMatchObject({ prNumber: 42, state: mergedState, mergeable })
      expect(fake.prStates[0]?.state).toBe(mergedState)
    },
  )

  it('a newly opened pull request supersedes the merged identity the branch row remembered', async () => {
    const reads = {
      readPullRequest: vi
        .fn<GithubUserReads['readPullRequest']>()
        .mockResolvedValueOnce({ ...REST_FIELDS, state: 'merged' })
        .mockResolvedValue({ ...REST_FIELDS, url: 'https://github.com/compai/app/pull/99' }),
      findOpenPrForBranch: vi
        .fn<GithubUserReads['findOpenPrForBranch']>()
        .mockResolvedValueOnce({ number: 42 })
        .mockResolvedValue({ number: 99 }),
    }
    const service = serviceWith({
      readPullRequest: reads.readPullRequest,
      findOpenPrForBranch: reads.findOpenPrForBranch,
    })

    const first = await service.subscribe(subscribe)
    expect(first.prNumber).toBe(42)
    expect(first.state?.state).toBe('merged')
    const again = await service.subscribe(subscribe)

    expect(again.prNumber).toBe(99)
    expect(reads.readPullRequest).toHaveBeenCalledWith(expect.objectContaining({ number: 99 }))
    expect(again.state).toMatchObject({
      prNumber: 99,
      state: 'open',
      url: 'https://github.com/compai/app/pull/99',
    })
  })

  it('never adopts a different user’s remembered PR for the same branch', async () => {
    const findOpenPrForBranch = vi.fn<GithubUserReads['findOpenPrForBranch']>()
      .mockResolvedValueOnce({ number: 42 })
      .mockResolvedValue(null)
    const readPullRequest = vi.fn<GithubUserReads['readPullRequest']>(async () => REST_FIELDS)
    const service = serviceWith({ findOpenPrForBranch, readPullRequest })
    await service.subscribe(subscribe)
    readPullRequest.mockClear()

    const other = await service.subscribe({ ...subscribe, userId: 'usr_2' })
    expect(other.prNumber).toBeNull()
    expect(other.state).toBeNull()
    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('a fresh branch with no known pull request stays null and pulls nothing', async () => {
    const readPullRequest = vi.fn<GithubUserReads['readPullRequest']>(async () => REST_FIELDS)
    const service = serviceWith({
      readPullRequest,
      findOpenPrForBranch: async () => null,
    })

    const dto = await service.subscribe({ ...subscribe, branch: 'dennis/never-had-a-pr' })

    expect(dto.prNumber).toBeNull()
    expect(dto.state).toBeNull()
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.prStates).toHaveLength(0)
  })
})
