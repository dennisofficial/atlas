import { afterEach, describe, expect, it } from 'bun:test'

import { runSseStream } from '../sse-client'
import { collect, startServer, waitFor, type TestServer } from './sse-test-server'

describe('runSseStream silence watchdog', () => {
  let server: TestServer | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('replaces a silent stream after silenceTimeoutMs and drops exactly once', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }, { status: 200, openEnded: true }],
    })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      silenceTimeoutMs: 150,
      randomFn: () => 0.01,
    })
    await waitFor(() => server!.requests.length >= 2 && opens() >= 2)
    controller.abort()
    await running

    expect(drops()).toBe(1)
    expect(server.requests.length).toBe(2)
    await waitFor(() => server!.liveStreams() === 0)
    expect(server.liveStreams()).toBe(0)
  })

  it('keeps a stream alive while heartbeat comment frames arrive', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true, heartbeatEveryMs: 50 }],
    })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      silenceTimeoutMs: 200,
      randomFn: () => 0.01,
    })
    await waitFor(() => opens() >= 1)
    await Bun.sleep(500)
    controller.abort()
    await running

    expect(server.requests).toHaveLength(1)
    expect(drops()).toBe(0)
  })

  it('runs no watchdog during the retry wait: aborting mid-backoff settles with one drop', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }, { status: 200, openEnded: true }],
    })

    const { drops, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      silenceTimeoutMs: 120,
      randomFn: () => 1,
    })
    await waitFor(() => drops() >= 1)
    await Bun.sleep(150)
    controller.abort()
    await running

    expect(drops()).toBe(1)
    expect(server.requests).toHaveLength(1)
  })

  it('keeps no orphan timer when the caller aborts while the onOpen catch-up runs', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true }],
    })

    const controller = new AbortController()
    let catchUpStarted = false
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        onFrame: () => {},
        onOpen: async () => {
          catchUpStarted = true
          await Bun.sleep(200)
        },
      },
      silenceTimeoutMs: 60,
      randomFn: () => 0.01,
    })
    await waitFor(() => catchUpStarted)
    controller.abort()
    await running
    await Bun.sleep(150)

    expect(server.requests).toHaveLength(1)
    expect(server.liveStreams()).toBe(0)
  })
})
