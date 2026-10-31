import { afterEach, describe, expect, it } from 'bun:test'

import { EForge, type RepositoryCheckout } from '../../plugins/github/pure'
import type { PrEventFrame } from '../pr-event-frame'
import { recoveryDelayMs } from '../sse-recovery'
import { SsePullRequestPort } from '../sse-pull-requests'
import { eventChunk, openStreamResponse, STREAM_PROCEDURE, trpcFailure, trpcOk } from './trpc-fakes'

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const STATE = {
  repoFullName: 'owner/repo',
  prNumber: 42,
  title: 'recover',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'open',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 1,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-10-31T00:00:00Z',
}

const goodFrame = {
  id: 'evt_merge',
  repoFullName: 'owner/repo',
  prNumber: 42,
  kind: 'comment',
  payload: { url: 'https://github.com/owner/repo/pull/42#c1', body: 'hi' },
  createdAt: '2026-10-31T00:00:00Z',
}

type Timer = { id: number; fn: () => void; ms: number; cleared: boolean }

const fakeClock = () => {
  const timers: Timer[] = []
  return {
    timers,
    clock: {
      randomFn: () => 1,
      setTimeoutFn: ((fn: () => void, ms: number) => {
        const timer: Timer = { id: timers.length, fn, ms, cleared: false }
        timers.push(timer)
        return Object.assign(timer, { unref: () => timer })
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: ((handle: Timer) => {
        handle.cleared = true
      }) as unknown as typeof clearTimeout,
    },
    pending: (ms: number) => timers.filter((t) => t.ms === ms && !t.cleared),
  }
}

const serve = () => {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let subscribeStatus = 200
  let subscribes = 0
  let streamAttempts = 0
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path.endsWith('/githubSubscriptions.subscribe')) {
        subscribes += 1
        if (subscribeStatus !== 200) return trpcFailure({ status: subscribeStatus })
        return trpcOk({
          id: 'sub_1',
          repoFullName: 'owner/repo',
          prNumber: 42,
          branch: 'feature',
          pollBacked: false,
          expiresAt: '2026-10-31T01:00:00Z',
          state: STATE,
        })
      }
      if (path.endsWith(`/${STREAM_PROCEDURE}`)) {
        streamAttempts += 1
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        return openStreamResponse({
          request,
          register: (controller) => {
            own = controller
            streams.add(controller)
          },
          onAbort: () => {
            if (own !== undefined) streams.delete(own)
          },
        })
      }
      return trpcOk(null)
    },
  })
  return {
    session: { url: `http://127.0.0.1:${server.port}`, token: 'test', email: null },
    setStatus: (status: number) => {
      subscribeStatus = status
    },
    subscribes: () => subscribes,
    streamAttempts: () => streamAttempts,
    send: (chunk: string) => {
      for (const stream of streams) stream.enqueue(new TextEncoder().encode(chunk))
    },
    stop: () => server.stop(true),
  }
}

const until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 4_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('recoveryDelayMs', () => {
  it('doubles from 30s, caps at 5 minutes, and jitters downward', () => {
    expect(recoveryDelayMs({ attempt: 0, random: 1 })).toBe(30_000)
    expect(recoveryDelayMs({ attempt: 2, random: 1 })).toBe(120_000)
    expect(recoveryDelayMs({ attempt: 10, random: 1 })).toBe(300_000)
    expect(recoveryDelayMs({ attempt: 10, random: 0 })).toBe(150_000)
  })
})

describe.each([403, 429])('PR stream recovery after a %d during catch-up', (status) => {
  let api: ReturnType<typeof serve> | null = null
  let port: SsePullRequestPort | null = null
  afterEach(() => {
    port?.dispose()
    api?.stop()
    port = null
    api = null
  })

  const start = (frames: PrEventFrame[], clock: ReturnType<typeof fakeClock>) => {
    api = serve()
    port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: () => {},
      onPrEvent: (frame) => frames.push(frame),
      clock: clock.clock,
      silenceTimeoutMs: 80,
    })
  }

  it('reopens the stream after the recovery delay and delivers later events', async () => {
    const frames: PrEventFrame[] = []
    const fake = fakeClock()
    start(frames, fake)
    await port?.read({ checkout: CHECKOUT })
    await until(() => api?.streamAttempts() === 1)

    const subscribesBefore = api?.subscribes() ?? 0
    api?.setStatus(status)
    await until(() => (api?.subscribes() ?? 0) > subscribesBefore)
    if (status === 403) await until(() => fake.pending(30_000).length > 0)
    if (status === 429) expect(fake.pending(30_000)).toHaveLength(0)

    api?.setStatus(200)
    const attemptsBefore = api?.streamAttempts() ?? 0
    if (status === 403) fake.pending(30_000)[0]?.fn()
    await until(() => (api?.streamAttempts() ?? 0) > attemptsBefore)
    await until(() => (api?.subscribes() ?? 0) >= 2)

    api?.send(eventChunk(goodFrame))
    await until(() => frames.length === 1)
    expect(frames[0]?.id).toBe('evt_merge')
  })

  it('dispose cancels a pending recovery timer', async () => {
    const fake = fakeClock()
    start([], fake)
    await port?.read({ checkout: CHECKOUT })
    await until(() => api?.streamAttempts() === 1)
    api?.setStatus(403)
    await until(() => fake.pending(30_000).length > 0)

    port?.dispose()
    expect(fake.pending(30_000)).toHaveLength(0)
  })
})
