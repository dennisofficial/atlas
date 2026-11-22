import { storeFixture } from './github-pr-store.fixture'
import { spyOn } from 'bun:test'
import type { RedisService } from '../../../_lib/redis/redis.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { inertMergeabilityRefresh, inertReconcile } from './github-pr-store.fixture'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubConfig } from './github-config'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { GithubHeadReads } from './github-head-reads'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { RedisPrFrameBus } from './github-pr-fanout.transport'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'
import { legacyOf } from './github-legacy-effects.fixture'
import { threadActivityAt } from './github-thread-activity'

export function mockGithubHttp() {
  const original = globalThis.fetch
  const calls: Array<{ path: string; token: string | null }> = []
  const denied = new Set<string>()
  const deniedRepos = new Set<string>()
  const limited = new Set<string>()
  let accessGate: ((args: { signal: AbortSignal | null | undefined }) => Promise<void>) | undefined
  const failures = new Set<number>()
  let state = 'open'
  let hooksAllowed = false
  let checksFailed = false
  const handleFetch = async (
    target: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = new URL(
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
    )
    if (url.hostname !== 'api.github.com') return original(target, init)
    const headers = new Headers(init?.headers)
    const token = headers.get('authorization')
    calls.push({ path: url.pathname, token })
    if (token !== null && limited.has(token))
      return Response.json(
        {},
        {
          status: 429,
          headers: { 'retry-after': '3600', 'x-ratelimit-resource': 'core' },
        },
      )
    if (token !== null && denied.has(token)) return Response.json({}, { status: 404 })
    const repository = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/)?.[1]
    if (repository !== undefined && deniedRepos.has(repository))
      return Response.json({}, { status: 404 })
    if (url.pathname.includes('/hooks'))
      return hooksAllowed
        ? Response.json({
            id: 123,
            events: [
              'pull_request',
              'check_suite',
              'check_run',
              'push',
              'status',
              'issue_comment',
              'pull_request_review',
              'pull_request_review_comment',
            ],
          })
        : Response.json({}, { status: 403 })
    const pull = url.pathname.match(/\/pulls\/(\d+)$/)
    if (pull !== null) {
      const number = Number(pull[1])
      if (failures.has(number)) return Response.json({}, { status: 404 })
      return Response.json({
        number,
        title: 'Live PR',
        html_url: `https://github.com/compai/app/pull/${number}`,
        state,
        draft: false,
        merged_at: null,
        updated_at: '2026-11-18T06:00:00Z',
        mergeable: true,
        mergeable_state: 'clean',
        head: {
          ref: 'dennis/add-the-thing',
          sha: 'abc123',
          repo: { full_name: 'CompAI/App' },
        },
        base: { ref: 'main' },
      })
    }
    if (url.pathname.includes('/rules/branches/')) return Response.json([])
    if (url.pathname.includes('/check-runs'))
      return Response.json({
        check_runs: [
          {
            id: 1,
            name: 'build',
            started_at: '2026-11-02T04:25:00Z',
            status: 'completed',
            conclusion: checksFailed ? 'failure' : 'success',
          },
        ],
      })
    if (url.pathname.endsWith('/check-suites')) return Response.json({ check_suites: [] })
    if (url.pathname.endsWith('/status')) return Response.json({ statuses: [] })
    if (url.pathname.endsWith('/pulls')) return Response.json([{ number: 42 }])
    await accessGate?.({ signal: init?.signal })
    return Response.json({ full_name: 'compai/app', private: true })
  }
  const mock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(handleFetch, { preconnect: original.preconnect }),
  )
  return {
    calls,
    denied,
    deniedRepos,
    limited,
    holdAccess: (gate: (args: { signal: AbortSignal | null | undefined }) => Promise<void>) => {
      accessGate = gate
    },
    failures,
    allowHooks: () => {
      hooksAllowed = true
    },
    setState: (value: string) => {
      state = value
    },
    failChecks: () => {
      checksFailed = true
    },
    restore: () => mock.mockRestore(),
  }
}

export function realGithubGraph(args: {
  redis: RedisService
  prefix: string
  tokens: Record<string, string>
  appBacked?: boolean
}) {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens[userId],
  } as unknown as GithubService
  const coordinator = new GithubRequestCoordinator(args.redis, github, args.prefix)
  const fanout = new GithubPrFanoutService(new DrainStateService(), new RedisPrFrameBus(args.redis))
  const reads = new GithubUserReads()
  const cipher = {
    encrypt: (plain: string) => plain,
    decrypt: (plain: string) => plain,
  } as unknown as SecretCipherService
  const config = new GithubConfig({ publicApiUrl: 'https://api.byatlas.io' })
  const installations = {
    coversRepo: async () => args.appBacked ?? true,
  } as unknown as GithubAppInstallationsService
  const hooks = new GithubHookLifecycleService(
    github,
    reads,
    cipher,
    config,
    installations,
    coordinator,
  )
  const signals: ThreadSignalsService = inertSignals()
  const wakes: unknown[] = []
  const wake = {
    notifyEvent: (notice: unknown) => wakes.push(notice),
  } as unknown as GithubSandboxWakeService
  const mailbox = new GithubPrEventMailboxService(
    fanout,
    new GithubPrOutboxDispatcher({
      fanout,
      legacy: legacyOf({ signals: signals, wake: wake }),
      reconcile: inertReconcile(),
      mergeability: inertMergeabilityRefresh(),
    }),
  )
  const discussion = new GithubPrDiscussionDeliveryService(mailbox)
  const delivery = new GithubDeliveryService(
    github,
    reads,
    fanout,
    cipher,
    mailbox,
    discussion,
    coordinator,
    storeFixture({ fanout, wake }),
  )
  const poll = new GithubPollSweeperService(
    github,
    reads,
    hooks,
    coordinator,
    new GithubHeadReads(),
    storeFixture({ fanout, wake }),
    threadActivityAt,
  )
  return {
    github,
    coordinator,
    fanout,
    reads,
    cipher,
    hooks,
    mailbox,
    delivery,
    poll,
    signals,
    wakes,
  }
}
