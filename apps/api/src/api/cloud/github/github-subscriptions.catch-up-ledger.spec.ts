import { seedHeadChecks } from '@dltech/atlas-github/testing'
import { observationReadOf } from '@dltech/atlas-github/testing'
import { storeFixture } from '@dltech/atlas-github/testing'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, prEventRows } from '../../../../test/github-seed'
import { localCoordinator } from '@dltech/atlas-github/testing'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import type { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import type { GithubHookLifecycleService } from '@dltech/atlas-github'
import type { GithubUserReads } from '@dltech/atlas-github'
import type { GithubService } from '@dltech/atlas-github'
import { threadActivityAt } from './github-thread-activity'

const SETTLED_FIELDS = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  checksRunning: 0,
  checksPassed: 4,
  checksFailed: 0,
  checksIgnored: 0,
  mergeable: true,
}

function serviceWith(args: {
  readPullRequest?: GithubUserReads['readPullRequest']
}): GithubSubscriptionsService {
  const github = { findToken: async () => 'ghu_1' } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => 'created' as const),
  } as unknown as GithubHookLifecycleService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => SETTLED_FIELDS),
    readPullRequestObservation: async (input: { number: number }) =>
      observationReadOf({
        fields: await (args.readPullRequest ?? (async () => SETTLED_FIELDS))(input as never),
        number: input.number,
      }),
    findOpenPrForBranch: async () => ({ number: 42 }),
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

describe('GithubSubscriptionsService subscribe catch-up', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.useRealTimers()
    await ensureUsers('usr_1')
  })

  afterEach(() => unstubAllGlobals())

  it('announces the current settled verdict once on first subscribe', async () => {
    const service = serviceWith({})
    await seedHeadChecks({ headSha: 'abc123', passed: 4 })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr_1',
      payload: { verdict: 'green', headSha: 'abc123', settled: true },
    })
  })

  it('does not re-announce when a second subscription observes the same settled head', async () => {
    await ensureUsers('usr_2')
    const service = serviceWith({})
    await seedHeadChecks({ headSha: 'abc123', passed: 4 })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    await service.subscribe({ userId: 'usr_2', repoFullName: 'compai/app', prNumber: 42 })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]?.userId).toBe('usr_1')
  })

  it('announces nothing on subscribe when checks are still running', async () => {
    const service = serviceWith({
      readPullRequest: async () => ({ ...SETTLED_FIELDS, checksRunning: 2, checksPassed: 1 }),
    })
    await seedHeadChecks({ headSha: 'abc123', passed: 1, running: 2 })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(await prEventRows()).toHaveLength(0)
  })
})
