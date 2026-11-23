import { observationReadOf } from '@dltech/atlas-github/testing'
import { storeFixture } from '@dltech/atlas-github/testing'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { localCoordinator } from '@dltech/atlas-github/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, prStateRows, subscriptionRows } from '../../../../test/github-seed'
import type { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import type { GithubHookLifecycleService } from '@dltech/atlas-github'
import type { GithubUserReads } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import type { GithubService } from '@dltech/atlas-github'
import type { PullRequestCacheFields } from '@dltech/atlas-github'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { threadActivityAt } from './github-thread-activity'

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
  checksIgnored: 0,
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
    readPullRequestObservation: async (input: { number: number }) =>
      observationReadOf({
        fields: await args.readPullRequest(input as never),
        number: input.number,
      }),
    findOpenPrForBranch: args.findOpenPrForBranch,
  } as unknown as GithubUserReads
  const installNotice = {
    installUrl: () => 'https://github.com/apps/atlas-by-dl/installations/new',
    shouldRecommend: async () => false,
    dismiss: async () => undefined,
  } as unknown as GithubAppInstallNoticeService
  stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
  return new GithubSubscriptionsService(
    github,
    reads,
    hooks,
    installNotice,
    localCoordinator(github),
    { coversRepo: async () => false } as never,
    storeFixture(),
    threadActivityAt,
  )
}

describe('GithubSubscriptionsService branch catch-up', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2')
  })
  afterEach(() => unstubAllGlobals())

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

      expect(await subscriptionRows()).toHaveLength(1)
      expect(second.id).toBe(first.id)
      expect(second.prNumber).toBe(42)
      expect(second.state).toMatchObject({ prNumber: 42, state: mergedState, mergeable })
      expect((await prStateRows())[0]?.state).toBe(mergedState)
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
    const findOpenPrForBranch = vi
      .fn<GithubUserReads['findOpenPrForBranch']>()
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
    expect(await prStateRows()).toHaveLength(0)
  })
})
