import { afterEach, describe, expect, it } from 'bun:test'

import { runSseStream, SseRefused } from '../sse-client'
import {
  collect,
  dataFrame,
  opened,
  prStateFrame,
  returnEvent,
  serializedError,
  startServer,
  text,
  waitFor,
  type TestServer,
} from './sse-test-server'
describe('runSseStream catch-up', () => {
  let server: TestServer | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('rejects with SseRefused when the onOpen catch-up is refused, without retrying', async () => {
    server = startServer({ responses: [{ status: 200, openEnded: true }] })

    const { drops, handlers } = collect()
    const controller = new AbortController()
    const failure = await runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        ...handlers,
        onOpen: async () => {
          throw new SseRefused(401)
        },
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(SseRefused)
    expect(failure).toMatchObject({ status: 401 })
    expect(drops()).toBe(0)
    expect(server.requests).toHaveLength(1)
    await waitFor(() => server!.liveStreams() === 0)
    expect(server.liveStreams()).toBe(0)
  })

  it('drops and retries when the onOpen catch-up rejects, leaving no abandoned stream', async () => {
    server = startServer({
      responses: [
        { status: 200, openEnded: true },
        { status: 200, openEnded: true },
      ],
    })

    const drops: number[] = []
    const controller = new AbortController()
    let openCalls = 0
    const running = runSseStream({
      baseUrl: server.url,
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
      baseUrl: server.url,
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
      responses: [
        { status: 200, openEnded: true },
        { status: 200, openEnded: true },
      ],
    })

    const { drops, handlers } = collect()
    const controller = new AbortController()
    let openCalls = 0
    let hungCatchUpSettled = false
    const started = Date.now()
    const running = runSseStream({
      baseUrl: server.url,
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
