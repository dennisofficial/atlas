import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { ensureUsers, prEventRows } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { localObservations } from './github-observation.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { RestCheckRun, RestCommitStatus } from './github-pull-request-mapping'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
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
  mergeable: true,
  mergeable_state: 'clean',
  head: { ref: 'dennis/drop-label', sha: SHA, repo: { full_name: 'compai/app' } },
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
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  return new GithubSubscriptionsService(
    github,
    new GithubUserReads(),
    hooks,
    installNotice,
    localObservations(github),
    new GithubPrEventMailboxService(fanout, wake),
    { coversRepo: async () => false } as never,
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

  it('asks GitHub for no check suites and stores its rollup state with the PR', async () => {
    const { paths } = githubHead({ runs: [], checksState: 'EXPECTED' })

    const state = await subscribe()

    expect(paths.some((path) => path.endsWith('/check-suites'))).toBe(false)
    expect(paths.some((path) => path.endsWith('/graphql'))).toBe(true)
    expect(state?.state?.checksState).toBe('expected')
    expect(state?.state?.checksRunning).toBe(0)
  })

  it('announces nothing when the head has no runs and no statuses', async () => {
    githubHead({ runs: [], statuses: [], checksState: 'EXPECTED' })

    await subscribe()

    expect(await verdicts()).toHaveLength(0)
  })

  it('announces green once the runner has completed its runs', async () => {
    githubHead({ runs: [completedRun(11), completedRun(12)], checksState: 'SUCCESS' })

    await subscribe()

    const emitted = await verdicts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })
})
