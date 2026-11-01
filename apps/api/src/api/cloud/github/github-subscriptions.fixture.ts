import { vi } from 'bun:test'
import { localObservations } from './github-observation.fixture'
import { stubGlobal } from '@dltech/bun-test-shims'
import type { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import type { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

export const REST_FIELDS: PullRequestCacheFields = {
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

const okFetch = async () => new Response('{}', { status: 200 })

export function serviceWith(args: {
  token?: string
  ensureHook?: 'created' | 'existing' | 'app-backed' | 'poll-backed'
  readPullRequest?: GithubUserReads['readPullRequest']
  findOpenPrForBranch?: GithubUserReads['findOpenPrForBranch']
  fetchImpl?: typeof fetch
  shouldRecommend?: () => Promise<boolean>
}): GithubSubscriptionsService {
  const github = {
    findToken: async () => args.token,
  } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => args.ensureHook ?? 'created'),
  } as unknown as GithubHookLifecycleService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
    findOpenPrForBranch: args.findOpenPrForBranch ?? (async () => ({ number: 42 })),
  } as unknown as GithubUserReads
  const installNotice = {
    installUrl: () => 'https://github.com/apps/atlas-by-dl/installations/new',
    shouldRecommend: args.shouldRecommend ?? (async () => false),
    dismiss: async () => undefined,
  } as unknown as GithubAppInstallNoticeService
  stubGlobal('fetch', args.fetchImpl ?? okFetch)
  return new GithubSubscriptionsService(
    github,
    reads,
    hooks,
    installNotice,
    localObservations(github),
  )
}
