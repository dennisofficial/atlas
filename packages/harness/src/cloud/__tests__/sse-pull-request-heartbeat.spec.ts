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
  prNumber: 902,
  title: 'heartbeat',
  url: 'https://github.com/owner/repo/pull/902',
  state: 'draft',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 2,
  checksPassed: 1,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-09-30T02:00:00Z',
  ...overrides,
})

const createApi = () => {
  let current = state()
  let authAccepted = true
  let subscriptionLive = true
  let heartbeats = 0
  let subscribes = 0
  let streamAttempts = 0
  let activeStreams = 0
  let ids = 0
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (!authAccepted) return Response.json({ message: 'token revoked' }, { status: 401 })
      if (path.endsWith('/heartbeat')) {
        heartbeats += 1
        if (!subscriptionLive) {
          return Response.json({ message: 'subscription expired' }, { status: 404 })
        }
        return Response.json({})
      }
      if (path.endsWith('/subscriptions') && request.method === 'POST') {
        subscribes += 1
        subscriptionLive = true
        ids += 1
        return Response.json({
          id: `sub_${ids}`,
          repoFullName: 'owner/repo',
          prNumber: current.prNumber,
          branch: 'feature',
          pollBacked: false,
          expiresAt: '2026-09-30T03:00:00Z',
          state: current,
        }, { status: 201 })
      }
      if (path.endsWith('/prs/stream')) {
        streamAttempts += 1
        activeStreams += 1
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            streams.add(controller)
            controller.enqueue(new TextEncoder().encode(': connected\n\n'))
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
    session: { url: `http://127.0.0.1:${server.port}`, token: 'static-token', email: null },
    setState: (value: SubscriptionPrState) => { current = value },
    expireSubscription: () => { subscriptionLive = false },
    revoke: () => { authAccepted = false },
    recover: () => { authAccepted = true },
    push: (value: SubscriptionPrState) => {
      for (const stream of streams) {
        stream.enqueue(new TextEncoder().encode(`event: pr-state\ndata: ${JSON.stringify(value)}\n\n`))
      }
    },
    heartbeats: () => heartbeats,
    subscribes: () => subscribes,
    streamAttempts: () => streamAttempts,
    activeStreams: () => activeStreams,
    stop: () => server.stop(true),
  }
}

const createClock = () => {
  const handlers: (() => void)[] = []
  const setIntervalFn = ((handler: unknown) => {
    if (typeof handler === 'function') handlers.push(handler as () => void)
    return { unref: () => undefined } as unknown as ReturnType<typeof setInterval>
  }) as typeof setInterval
  return {
    clock: {
      now: () => 0,
      setIntervalFn,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    },
    fire: () => {
      for (const handler of [...handlers]) handler()
    },
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

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!condition() && Date.now() < deadline) await Bun.sleep(10)
  if (!condition()) throw new Error('condition did not arrive in time')
}

const hasState = (expected: EPullRequestState) => (reading: PullRequestReading): boolean =>
  reading.lookup === EPullRequestLookup.Found && reading.pullRequest.state === expected

const hasFailures = (reading: PullRequestReading): boolean =>
  reading.lookup === EPullRequestLookup.Found && reading.pullRequest.tally.failed === 1

describe('SsePullRequestPort heartbeat failure catch-up', () => {
  let api: ReturnType<typeof createApi> | null = null
  let port: SsePullRequestPort | null = null
  afterEach(() => {
    port?.dispose()
    api?.stop()
    port = null
    api = null
  })

  it('resubscribes with fresh state when the shared subscription expired, then routes pushes', async () => {
    api = createApi()
    const feed = readingsFeed()
    const clock = createClock()
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: feed.onReading,
      clock: clock.clock,
    })

    const first = await port.read({ checkout: CHECKOUT })
    expect(first.lookup).toBe(EPullRequestLookup.Found)
    await waitFor(() => api!.subscribes() >= 2)

    api.expireSubscription()
    api.setState(state({ state: 'merged', checksRunning: 0, checksPassed: 8 }))
    clock.fire()

    const merged = await feed.next(hasState(EPullRequestState.Merged))
    if (merged.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(merged.pullRequest.tally).toEqual({ running: 0, passed: 8, failed: 0 })
    expect(api.heartbeats()).toBe(1)
    expect(api.subscribes()).toBe(3)

    api.push(state({ state: 'open', checksRunning: 1, checksPassed: 6, checksFailed: 1 }))
    const pushed = await feed.next(hasFailures)
    if (pushed.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(pushed.pullRequest.tally).toEqual({ running: 1, passed: 6, failed: 1 })
    expect(api.activeStreams()).toBe(1)
  })

  it('marks the reading Unavailable retryable and aborts on revoked token, then recovers on read', async () => {
    api = createApi()
    const feed = readingsFeed()
    const clock = createClock()
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: feed.onReading,
      clock: clock.clock,
    })

    const first = await port.read({ checkout: CHECKOUT })
    expect(first.lookup).toBe(EPullRequestLookup.Found)
    await waitFor(() => api!.subscribes() >= 2)

    api.revoke()
    clock.fire()

    const unavailable = await feed.next((reading) => reading.lookup === EPullRequestLookup.Unavailable)
    if (unavailable.lookup !== EPullRequestLookup.Unavailable) throw new Error('expected unavailable')
    expect(unavailable.retryable).toBe(true)
    await waitFor(() => api!.activeStreams() === 0)
    expect(api.streamAttempts()).toBe(1)

    api.recover()
    const recovered = await port.read({ checkout: CHECKOUT })
    expect(recovered.lookup).toBe(EPullRequestLookup.Found)
    await waitFor(() => api!.streamAttempts() >= 2)
    await waitFor(() => api!.activeStreams() === 1)
    expect(api.subscribes()).toBe(4)
  })
})
