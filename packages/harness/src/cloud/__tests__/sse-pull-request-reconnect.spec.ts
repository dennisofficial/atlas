import { afterEach, describe, expect, it } from 'bun:test'

import {
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../../plugins/github/pure'
import type { SubscriptionPrState } from '../pr-subscription-client'
import { SsePullRequestPort } from '../sse-pull-requests'

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const state = (overrides: Partial<SubscriptionPrState> = {}): SubscriptionPrState => ({
  repoFullName: 'owner/repo',
  prNumber: 896,
  title: 'reconnect',
  url: 'https://github.com/owner/repo/pull/896',
  state: 'draft',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 7,
  checksPassed: 1,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-09-30T02:00:00Z',
  ...overrides,
})

const createApi = () => {
  let current = state()
  let activeStreams = 0
  let peakStreams = 0
  let streamAttempts = 0
  let subscribes = 0
  const subscriptionWaiters = new Set<() => void>()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let deletedSubscriptions = 0
  let subscribeFailure = false
  let failedSubscribes = 0
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method === 'DELETE') {
        deletedSubscriptions += 1
        return Response.json({})
      }
      if (path.endsWith('/subscriptions')) {
        subscribes += 1
        for (const notify of subscriptionWaiters) notify()
        if (subscribeFailure) {
          subscribeFailure = false
          failedSubscribes += 1
          return Response.json({ message: 'redeploying' }, { status: 503 })
        }
        return Response.json({
          id: 'sub_1',
          repoFullName: 'owner/repo',
          prNumber: current.prNumber,
          pollBacked: false,
          expiresAt: '2026-09-30T03:00:00Z',
          state: current,
        })
      }
      if (path.endsWith('/prs/stream')) {
        streamAttempts += 1
        activeStreams += 1
        peakStreams = Math.max(peakStreams, activeStreams)
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            streams.add(controller)
            controller.enqueue(new TextEncoder().encode('event: heartbeat\ndata: {}\n\n'))
            request.signal.addEventListener('abort', () => {
              activeStreams -= 1
              streams.delete(controller)
              controller.close()
            }, { once: true })
          },
        }), { headers: { 'content-type': 'text/event-stream' } })
      }
      return Response.json({})
    },
  })
  return {
    session: { url: `http://127.0.0.1:${server.port}`, token: 'test', email: null },
    setState: (value: SubscriptionPrState) => { current = value },
    failSubscribe: (value: boolean) => { subscribeFailure = value },
    push: (value: SubscriptionPrState) => {
      for (const stream of streams) {
        stream.enqueue(new TextEncoder().encode(`event: pr-state\ndata: ${JSON.stringify(value)}\n\n`))
      }
    },
    waitForSubscribes: (count: number): Promise<void> => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscription did not arrive')), 4_000)
      const handleSubscribe = () => {
        if (subscribes < count) return
        clearTimeout(timeout)
        subscriptionWaiters.delete(handleSubscribe)
        resolve()
      }
      subscriptionWaiters.add(handleSubscribe)
      handleSubscribe()
    }),
    subscribes: () => subscribes,
    failedSubscribes: () => failedSubscribes,
    streamAttempts: () => streamAttempts,
    peakStreams: () => peakStreams,
    deletedSubscriptions: () => deletedSubscriptions,
    stop: () => server.stop(true),
  }
}

const readingsFeed = () => {
  const readings: PullRequestReading[] = []
  const listeners = new Set<() => void>()
  return {
    readings,
    onReading: ({ reading }: { reading: PullRequestReading }) => {
      readings.push(reading)
      for (const listener of listeners) listener()
    },
    next: (predicate: (reading: PullRequestReading) => boolean): Promise<PullRequestReading> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(handleReading)
          reject(new Error('expected PR reading did not arrive'))
        }, 4_000)
        const handleReading = () => {
          const reading = readings.find(predicate)
          if (reading === undefined) return
          clearTimeout(timer)
          listeners.delete(handleReading)
          resolve(reading)
        }
        listeners.add(handleReading)
        handleReading()
      }),
  }
}

const hasState = (expected: EPullRequestState) => (reading: PullRequestReading): boolean =>
  reading.lookup === EPullRequestLookup.Found && reading.pullRequest.state === expected

const hasFailures = (reading: PullRequestReading): boolean =>
  reading.lookup === EPullRequestLookup.Found && reading.pullRequest.tally.failed === 1

describe('PR stream reconnect catch-up', () => {
  let api: ReturnType<typeof createApi> | null = null
  let port: SsePullRequestPort | null = null
  afterEach(() => {
    port?.dispose()
    api?.stop()
    port = null
    api = null
  })

  it('recovers a missed merge without another webhook, then receives live CI updates', async () => {
    api = createApi()
    const feed = readingsFeed()
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: feed.onReading,
      silenceTimeoutMs: 80,
    })
    await port.read({ checkout: CHECKOUT })
    await feed.next(hasState(EPullRequestState.Draft))
    await api.waitForSubscribes(2)
    api.setState(state({ state: 'merged', checksRunning: 0, checksPassed: 8 }))

    await feed.next(hasState(EPullRequestState.Merged))
    expect(api.streamAttempts()).toBeGreaterThanOrEqual(2)
    expect(api.peakStreams()).toBe(1)
    expect(feed.readings.some((reading) => reading.lookup === EPullRequestLookup.Unavailable)).toBe(true)

    api.push(state({ state: 'open', checksRunning: 1, checksPassed: 7, checksFailed: 1 }))
    const updated = await feed.next(hasFailures)
    if (updated.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(updated.pullRequest.tally).toEqual({ running: 1, passed: 7, failed: 1 })
  })

  it('closing one client leaves the shared subscription available to another client', async () => {
    api = createApi()
    const first = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: () => {},
    })
    const feed = readingsFeed()
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: feed.onReading,
    })
    try {
      await first.read({ checkout: CHECKOUT })
      api.setState(state({ checksFailed: 1 }))
      await port.read({ checkout: CHECKOUT })
      await feed.next(hasFailures)
      first.dispose()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(api.deletedSubscriptions()).toBe(0)
      api.push(state({ state: 'merged' }))
      await feed.next(hasState(EPullRequestState.Merged))
    } finally {
      first.dispose()
    }
  })

  it('retries catch-up when the API reconnects before subscriptions are available', async () => {
    api = createApi()
    const feed = readingsFeed()
    let failedOnce = false
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: ({ reading }) => {
        feed.onReading({ reading })
        if (reading.lookup === EPullRequestLookup.Unavailable && !failedOnce) {
          failedOnce = true
          api?.failSubscribe(true)
        }
      },
      silenceTimeoutMs: 80,
    })
    await port.read({ checkout: CHECKOUT })
    await api.waitForSubscribes(2)
    api.setState(state({ state: 'merged', checksRunning: 0 }))
    await feed.next((reading) => reading.lookup === EPullRequestLookup.Unavailable)
    await feed.next(hasState(EPullRequestState.Merged))
    expect(api.failedSubscribes()).toBe(1)
    expect(api.peakStreams()).toBe(1)
  })
})
