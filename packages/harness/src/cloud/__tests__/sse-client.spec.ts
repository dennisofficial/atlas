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

describe('runSseStream', () => {
  let server: TestServer | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('delivers frames and sends the bearer token and client version', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true, body: opened(dataFrame(prStateFrame())) }],
    })

    const { frames, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok-1',
      clientVersion: 'v-test',
      signal: controller.signal,
      handlers,
    })

    await waitFor(() => frames.length > 0)
    controller.abort()
    await running

    expect(frames).toEqual([prStateFrame()])
    expect(opens()).toBe(1)
    expect(server.requests[0]?.path).toBe('/v1/trpc/githubPrs.stream')
    expect(server.requests[0]?.authorization).toBe('Bearer tok-1')
    expect(server.requests[0]?.clientVersion).toBe('v-test')
  })

  it('never forwards heartbeat frames to onFrame', async () => {
    server = startServer({
      responses: [
        {
          status: 200,
          openEnded: true,
          heartbeatEveryMs: 20,
          body: opened(dataFrame(prStateFrame())),
        },
      ],
    })

    const { frames, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
    })
    await waitFor(() => frames.length > 0)
    await Bun.sleep(120)
    controller.abort()
    await running

    expect(frames).toEqual([prStateFrame()])
  })

  it('buffers frames that arrive before the onOpen catch-up settles and delivers them after', async () => {
    server = startServer({
      responses: [{ status: 200, openEnded: true, body: opened(dataFrame(prStateFrame())) }],
    })

    const order: string[] = []
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers: {
        onFrame: () => order.push('frame'),
        onOpen: async () => {
          order.push('catch-up started')
          await Bun.sleep(150)
          order.push('catch-up settled')
        },
      },
    })
    await waitFor(() => order.includes('frame'))
    controller.abort()
    await running

    expect(order).toEqual(['catch-up started', 'catch-up settled', 'frame'])
  })

  it.each([401, 403])('rejects with SseRefused on %s rather than retrying', async (status) => {
    server = startServer({ responses: [{ status }] })

    const { handlers } = collect()
    await expect(
      runSseStream({
        baseUrl: server.url,
        token: 'dead',
        clientVersion: 'test',
        signal: new AbortController().signal,
        handlers,
      }),
    ).rejects.toBeInstanceOf(SseRefused)
    expect(server.requests).toHaveLength(1)
  })

  it.each([
    [401, 'UNAUTHORIZED', -32001],
    [403, 'FORBIDDEN', -32003],
  ])(
    'rejects with SseRefused on a serialized %s after the connected event',
    async (httpStatus, code, number) => {
      server = startServer({
        responses: [
          text(`event: connected\ndata: {}\n\n${serializedError({ code, httpStatus, number })}`),
        ],
      })

      const { handlers } = collect()
      const refusal = await runSseStream({
        baseUrl: server.url,
        token: 'dead',
        clientVersion: 'test',
        signal: new AbortController().signal,
        handlers,
      }).then(
        () => undefined,
        (failure: unknown) => failure,
      )

      expect(refusal).toBeInstanceOf(SseRefused)
      expect(refusal).toMatchObject({ status: httpStatus })
      expect(server.requests).toHaveLength(1)
    },
  )

  it('reconnects after a drop, fires onOpen per open and onDrop once per drop', async () => {
    server = startServer({
      responses: [
        text(opened(dataFrame(prStateFrame({ prNumber: 1 })))),
        { status: 200, openEnded: true, body: opened(dataFrame(prStateFrame({ prNumber: 2 }))) },
      ],
    })

    const { frames, drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'v-test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await waitFor(() => server!.requests.length >= 2 && opens() >= 2 && frames.length >= 1)
    controller.abort()
    await running

    expect(drops()).toBe(1)
    expect(frames).toEqual([prStateFrame({ prNumber: 2 })])
    for (const request of server.requests) {
      expect(request.authorization).toBe('Bearer tok')
      expect(request.clientVersion).toBe('v-test')
    }
  })

  it('treats a stream the server ended with a return event as a drop and reconnects', async () => {
    server = startServer({
      responses: [text(opened(returnEvent())), { status: 200, openEnded: true }],
    })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await waitFor(() => server!.requests.length >= 2 && opens() >= 2)
    controller.abort()
    await running

    expect(drops()).toBe(1)
  })

  it('treats a retryable serialized 503 as a drop and reconnects', async () => {
    server = startServer({
      responses: [
        text(
          `event: connected\ndata: {}\n\n${serializedError({ code: 'SERVICE_UNAVAILABLE', httpStatus: 503, number: -32603 })}`,
        ),
        { status: 200, openEnded: true },
      ],
    })

    const { drops, opens, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      baseUrl: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await waitFor(() => opens() >= 1)
    controller.abort()
    await running

    expect(drops()).toBe(1)
    expect(server.requests).toHaveLength(2)
  })

  it('resolves without a request when the signal is already aborted', async () => {
    server = startServer({ responses: [{ status: 200, openEnded: true }] })

    const controller = new AbortController()
    controller.abort()
    await runSseStream({
      baseUrl: server.url,
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
      baseUrl: server.url,
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
      baseUrl: server.url,
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
})
