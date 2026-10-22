import { afterEach, describe, expect, it } from 'vitest'

import {
  EForge,
  EPullRequestLookup,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../../plugins/github/pure'
import type { AppInstallRecommendation, SubscriptionPrState } from '../pr-subscription-client'
import { createSseSubscriptionBook } from '../sse-pull-request-book'
import { SsePullRequestPort } from '../sse-pull-requests'

const state = (overrides: Partial<SubscriptionPrState> = {}): SubscriptionPrState => ({
  repoFullName: 'owner/repo',
  prNumber: 42,
  title: 'polled',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'open',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 1,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-10-15T02:00:00Z',
  ...overrides,
})

const pollBackedOf = (reading: PullRequestReading | null | undefined): boolean | undefined => {
  if (reading?.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
  return reading.pullRequest.pollBacked
}

describe('the book remembers pollBacked per subscription', () => {
  const subscribed = (pollBacked: boolean | undefined) => {
    const book = createSseSubscriptionBook({ now: () => 0, onReading: () => {} })
    const reading = book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
      ...(pollBacked === undefined ? {} : { pollBacked }),
    })
    return { book, reading }
  }

  it('marks the subscribe reading polled', () => {
    expect(pollBackedOf(subscribed(true).reading)).toBe(true)
  })

  it('leaves a realtime subscribe reading without the flag', () => {
    expect(pollBackedOf(subscribed(false).reading)).toBeUndefined()
    expect(pollBackedOf(subscribed(undefined).reading)).toBeUndefined()
  })

  it('keeps the flag on readings pushed by later frames', () => {
    const { book } = subscribed(true)
    book.applyFrame({ data: JSON.stringify(state({ checksRunning: 0, checksPassed: 3 })) })
    expect(pollBackedOf(book.holding({ key: 'k' })?.reading)).toBe(true)
  })

  it('applies the flag to a pull request discovered by branch', () => {
    const book = createSseSubscriptionBook({ now: () => 0, onReading: () => {} })
    book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: null,
      pollBacked: true,
    })
    book.applyFrame({ data: JSON.stringify(state()) })
    expect(pollBackedOf(book.holding({ key: 'k' })?.reading)).toBe(true)
  })

  it('re-emits when a resubscribe flips the entry from polled to realtime', () => {
    const emitted: PullRequestReading[] = []
    const book = createSseSubscriptionBook({
      now: () => 0,
      onReading: ({ reading }) => emitted.push(reading),
    })
    book.recordSubscribe({
      key: 'k',
      handle: { id: 'sub-1', repoFullName: 'owner/repo' },
      by: { kind: 'branch', branch: 'feature' },
      state: state(),
      pollBacked: true,
    })
    book.recordResubscribe({
      key: 'k',
      handle: { id: 'sub-2', repoFullName: 'owner/repo' },
      state: state(),
      pollBacked: false,
    })

    expect(emitted).toHaveLength(2)
    expect(pollBackedOf(emitted[1])).toBeUndefined()
    expect(pollBackedOf(book.holding({ key: 'k' })?.reading)).toBeUndefined()
  })
})

describe('SsePullRequestPort subscribe outcome', () => {
  const realFetch = globalThis.fetch
  const ports: SsePullRequestPort[] = []
  afterEach(() => {
    for (const port of ports.splice(0)) port.dispose()
    globalThis.fetch = realFetch
  })

  const CHECKOUT: RepositoryCheckout = {
    directory: '/repo',
    branch: 'feature',
    forge: EForge.GitHub,
    remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
  }

  const serve = (extra: Record<string, unknown>): void => {
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).endsWith('/v1/github/subscriptions')) {
        return new Response(
          JSON.stringify({
            id: 'sub_1',
            repoFullName: 'owner/repo',
            prNumber: 42,
            branch: 'feature',
            pollBacked: true,
            expiresAt: '2026-10-15T03:00:00.000Z',
            state: state(),
            ...extra,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch
  }

  const portOf = (onAppInstallRecommended?: (recommendation: AppInstallRecommendation) => void) => {
    const port = new SsePullRequestPort({
      session: { url: 'https://api.test', token: 'tok', email: null },
      clientVersion: 'test',
      onReading: () => {},
      clock: { now: () => 0 },
      ...(onAppInstallRecommended === undefined ? {} : { onAppInstallRecommended }),
    })
    ports.push(port)
    return port
  }

  it('returns a polled reading when the subscription is poll-backed', async () => {
    serve({})
    expect(pollBackedOf(await portOf().read({ checkout: CHECKOUT }))).toBe(true)
  })

  it('hands the app install recommendation to the surface exactly once', async () => {
    serve({
      recommendAppInstall: {
        installUrl: 'https://github.com/apps/atlas/installations/new',
        repoFullName: 'owner/repo',
      },
    })
    const raised: AppInstallRecommendation[] = []
    const port = portOf((recommendation) => raised.push(recommendation))

    await port.read({ checkout: CHECKOUT })
    await port.readLinked({ repo: 'github.com/owner/repo', number: 42 })

    expect(raised).toEqual([
      { installUrl: 'https://github.com/apps/atlas/installations/new', repoFullName: 'owner/repo' },
    ])
  })

  it('raises nothing when the response carries no recommendation', async () => {
    serve({})
    const raised: AppInstallRecommendation[] = []
    await portOf((recommendation) => raised.push(recommendation)).read({ checkout: CHECKOUT })
    expect(raised).toEqual([])
  })

  it('survives a throwing recommendation consumer', async () => {
    serve({
      recommendAppInstall: { installUrl: 'https://x.test/install', repoFullName: 'owner/repo' },
    })
    const port = portOf(() => {
      throw new Error('consumer broke')
    })
    expect((await port.read({ checkout: CHECKOUT })).lookup).toBe(EPullRequestLookup.Found)
  })
})
