import { seedHeadChecks } from './github-pr-checks.fixture'
import { storeFixture } from './github-pr-store.fixture'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { ensureUsers, prEventRows } from '../../../../test/github-seed'
import type { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { localCoordinator } from './github-request-coordinator.fixture'
import type { RestCheckRun, RestCommitStatus } from './github-pull-request-mapping'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

const SHA = 'abc123'
const ACTIONS = { slug: 'github-actions' }

const VERCEL_STATUSES: RestCommitStatus[] = ['Vercel – atlas-api', 'Vercel – atlas-storybook'].map(
  (context) => ({
    context,
    state: 'success',
    created_at: '2026-11-04T21:50:45Z',
    updated_at: '2026-11-04T21:50:45Z',
  }),
)

const pullOf = () => ({
  number: 42,
  title: 'drop the merged label',
  html_url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: '2026-11-18T06:00:00Z',
  mergeable: true,
  mergeable_state: 'clean',
  head: { ref: 'dennis/drop-label', sha: SHA, repo: { full_name: 'compai/app' } },
  base: { ref: 'main' },
})

const completedRun = (id: number): RestCheckRun => ({
  id,
  name: `job-${id}`,
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-04T21:50:49Z',
  completed_at: '2026-11-04T21:54:30Z',
  app: ACTIONS,
})

function githubHead(args: {
  runs: RestCheckRun[]
  statuses?: RestCommitStatus[]
  checksState?: string | null
}) {
  const paths: string[] = []
  stubGlobal('fetch', async (input: URL | string | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    paths.push(url.pathname)
    if (url.pathname.endsWith('/pulls/42')) return Response.json(pullOf())
    if (url.pathname.endsWith('/graphql')) {
      return Response.json({
        data: {
          repository: { pullRequest: { statusCheckRollup: { state: args.checksState ?? null } } },
        },
      })
    }
    if (url.pathname.endsWith('/check-runs')) return Response.json({ check_runs: args.runs })
    if (url.pathname.endsWith('/status')) {
      return Response.json({ statuses: args.statuses ?? VERCEL_STATUSES })
    }
    return Response.json({})
  })
  return { paths }
}

function subscriptionsService(): GithubSubscriptionsService {
  const github = { findToken: async () => 'ghu_1' } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => 'created' as const),
  } as unknown as GithubHookLifecycleService
  const installNotice = {
    installUrl: () => 'https://github.com/apps/atlas-by-dl/installations/new',
    shouldRecommend: async () => false,
    dismiss: async () => undefined,
  } as unknown as GithubAppInstallNoticeService
  return new GithubSubscriptionsService(
    github,
    new GithubUserReads(),
    hooks,
    installNotice,
    localCoordinator(github),
    { coversRepo: async () => false } as never,
    storeFixture(),
  )
}

const subscribe = () =>
  subscriptionsService().subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

const verdicts = async () => (await prEventRows()).filter((row) => row.kind === 'verdict')

describe('subscribe and read the head', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.useRealTimers()
    await ensureUsers('usr_1')
  })

  afterEach(() => unstubAllGlobals())

  it('asks GitHub for no check suites and stores the derived tally state with the PR', async () => {
    const { paths } = githubHead({ runs: [], checksState: 'EXPECTED' })
    await seedHeadChecks({ headSha: SHA, passed: 1 })

    const state = await subscribe()

    expect(paths.some((path) => path.endsWith('/check-suites'))).toBe(false)
    expect(state?.state?.checksState).toBe('success')
    expect(state?.state?.checksRunning).toBe(0)
  })

  it('announces nothing when the head has no runs and no statuses', async () => {
    githubHead({ runs: [], statuses: [], checksState: 'EXPECTED' })

    await subscribe()

    expect(await verdicts()).toHaveLength(0)
  })

  it('announces green once the ledger holds the completed runs', async () => {
    githubHead({ runs: [completedRun(11), completedRun(12)], checksState: 'SUCCESS' })
    await seedHeadChecks({ headSha: SHA, passed: 2 })

    await subscribe()

    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })
})
