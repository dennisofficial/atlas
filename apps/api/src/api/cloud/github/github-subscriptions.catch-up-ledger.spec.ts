import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, prEventRows } from '../../../../test/github-seed'
import { localObservations } from './github-observation.fixture'
import { stubGlobal } from '@dltech/bun-test-shims'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

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
    findOpenPrForBranch: async () => ({ number: 42 }),
  } as unknown as GithubUserReads
  const installNotice = {
    installUrl: () => 'https://github.com/apps/atlas-by-dl/installations/new',
    shouldRecommend: async () => false,
    dismiss: async () => undefined,
  } as unknown as GithubAppInstallNoticeService
  stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  return new GithubSubscriptionsService(
    github,
    reads,
    hooks,
    installNotice,
    localObservations(github),
    new GithubPrEventMailboxService(fanout, wake),
  )
}

describe('GithubSubscriptionsService subscribe catch-up', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.useRealTimers()
    await ensureUsers('usr_1')
  })

  it('announces the current settled verdict once on first subscribe', async () => {
    const service = serviceWith({})

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

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(await prEventRows()).toHaveLength(0)
  })
})
