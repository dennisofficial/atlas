import { observationReadOf } from '@dltech/atlas-github/testing'
import { storeFixture } from '@dltech/atlas-github/testing'
import { vi } from 'bun:test'
import { localCoordinator } from '@dltech/atlas-github/testing'
import { stubGlobal } from '@dltech/bun-test-shims'
import { GithubAppInstallationsService } from '@dltech/atlas-github'
import type { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import type { GithubHookLifecycleService } from '@dltech/atlas-github'
import type { PullRequestCacheFields } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import type { GithubPrEventMailboxService } from '@dltech/atlas-github'
import type { GithubUserReads } from '@dltech/atlas-github'
import type { GithubService } from '@dltech/atlas-github'
import { threadActivityAt } from './github-thread-activity'

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
  checksIgnored: 0,
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
  mailbox?: GithubPrEventMailboxService
  coversRepo?: (args: { repoFullName: string }) => Promise<boolean>
}): GithubSubscriptionsService {
  const github = {
    findToken: async () => args.token,
  } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => args.ensureHook ?? 'created'),
  } as unknown as GithubHookLifecycleService
  const readPullRequest = args.readPullRequest ?? (async () => REST_FIELDS)
  const reads = {
    readPullRequest,
    readPullRequestObservation: async (input: { number: number }) =>
      observationReadOf({ fields: await readPullRequest(input as never), number: input.number }),
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
    localCoordinator(github),
    args.coversRepo === undefined
      ? new GithubAppInstallationsService()
      : ({ coversRepo: args.coversRepo } as never),
    storeFixture(),
    threadActivityAt,
  )
}
