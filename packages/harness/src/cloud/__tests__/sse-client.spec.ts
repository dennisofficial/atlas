import { afterEach, describe, expect, it } from 'bun:test'

import { runSseStream, SseRefused } from '../sse-client'
import { collect, frame, startServer, text, waitFor, type TestServer } from './sse-test-server'

describe('runSseStream', () => {
  let server: TestServer | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('delivers frames and sends the bearer token and client version', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true, body: frame({ event: 'pr-state', data: { n: 1 } }) }],
    })

    const { frames, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok-1',
      clientVersion: 'v-test',
      signal: controller.signal,
      handlers,
    })

    await waitFor(() => frames.length > 0)
    controller.abort()
    await running

    expect(frames).toEqual([{ id: undefined, event: 'pr-state', data: '{"n":1}' }])
    expect(opens()).toBe(1)
    expect(server.requests[0]?.authorization).toBe('Bearer tok-1')
    expect(server.requests[0]?.clientVersion).toBe('v-test')
  })

  it.each([401, 403])('rejects with SseRefused on %s rather than retrying', async (status) => {
    server = startServer({ responses: [{ status }] })

    const { handlers } = collect()
    await expect(
      runSseStream({
        url: server.url,
        token: 'dead',
        clientVersion: 'test',
        signal: new AbortController().signal,
        handlers,
      }),
    ).rejects.toBeInstanceOf(SseRefused)
    expect(server.requests).toHaveLength(1)
  })

  it('reconnects after a drop, fires onOpen per open and onDrop once per drop', async () => {
    server = startServer({
      responses: [
        text(frame({ event: 'pr-state', data: { n: 1 } })),
        { status: 200, openEnded: true },
      ],
    })

    const { frames, drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'v-test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await waitFor(() => server!.requests.length >= 2 && opens() >= 2)
    controller.abort()
    await running

    expect(drops()).toBe(1)
    expect(frames).toEqual([{ id: undefined, event: 'pr-state', data: '{"n":1}' }])
    for (const request of server.requests) {
      expect(request.authorization).toBe('Bearer tok')
      expect(request.clientVersion).toBe('v-test')
    }
  })

  it('resolves without a request when the signal is already aborted', async () => {
    server = startServer({ responses: [{ status: 200, openEnded: true }] })

    const controller = new AbortController()
    controller.abort()
    await runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: collect().handlers,
    })
    expect(server.requests).toHaveLength(0)
  })

  it('aborts a live stream without firing onDrop and closes the server side', async () => {
    server = startServer({ responses: [{ status: 200, openEnded: true }] })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
    })
    await waitFor(() => opens() >= 1)
    controller.abort()
    await running

    expect(drops()).toBe(0)
    expect(server.requests).toHaveLength(1)
    await waitFor(() => server!.liveStreams() === 0)
    expect(server.liveStreams()).toBe(0)
  })

  it('retries a 200 that is not an event stream instead of treating it as live', async () => {
    server = startServer({
      responses: [
        { status: 200, contentType: 'application/json', body: '{"error":"upstream"}' },
        { status: 200, openEnded: true },
      ],
    })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await waitFor(() => opens() >= 1)
    controller.abort()
    await running

    expect(server.requests).toHaveLength(2)
    expect(drops()).toBe(1)
  })

  it('drops and retries when the onOpen catch-up rejects, leaving no abandoned stream', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }, { status: 200, openEnded: true }],
    })

    const drops: number[] = []
    const controller = new AbortController()
    let openCalls = 0
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        onFrame: () => {},
        onDrop: () => drops.push(Date.now()),
        onOpen: async () => {
          openCalls += 1
          if (openCalls === 1) throw new Error('catch-up failed')
        },
      },
      randomFn: () => 0.01,
    })
    await waitFor(() => openCalls >= 2)
    controller.abort()
    await running

    expect(drops.length).toBe(1)
    expect(server.requests).toHaveLength(2)
    await waitFor(() => server!.liveStreams() === 0)
    expect(server.liveStreams()).toBe(0)
  })

  it('escalates the backoff across successive onOpen rejections instead of pinning to the floor', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }],
    })

    const rejectedAt: number[] = []
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        onFrame: () => {},
        onOpen: async () => {
          rejectedAt.push(Date.now())
          throw new Error('catch-up failed')
        },
      },
      randomFn: () => 0.1,
    })
    await waitFor(() => rejectedAt.length >= 3)
    controller.abort()
    await running

    const gaps = rejectedAt.slice(1).map((at, i) => at - (rejectedAt[i] ?? at))
    expect(gaps).toHaveLength(2)
    expect(gaps[0]!).toBeLessThan(250)
    expect(gaps[1]!).toBeGreaterThanOrEqual(160)
  })

  it('reconnects immediately when the catch-up outlives the silence timeout', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }, { status: 200, openEnded: true }],
    })

    const { drops, handlers } = collect()
    const controller = new AbortController()
    let openCalls = 0
    let hungCatchUpSettled = false
    const started = Date.now()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        ...handlers,
        onOpen: async () => {
          openCalls += 1
          if (openCalls !== 1) return
          await Bun.sleep(5_000)
          hungCatchUpSettled = true
        },
      },
      silenceTimeoutMs: 150,
      randomFn: () => 0.1,
    })
    await waitFor(() => openCalls >= 2)
    const reconnectMs = Date.now() - started
    controller.abort()
    await running

    expect(hungCatchUpSettled).toBe(false)
    expect(reconnectMs).toBeLessThan(1_000)
    expect(drops()).toBe(1)
    await waitFor(() => server!.liveStreams() === 0)
    expect(server.liveStreams()).toBe(0)
  })
})
