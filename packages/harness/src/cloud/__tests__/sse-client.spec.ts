import { afterEach, describe, expect, it } from 'bun:test'

import { runSseStream, SseRefused } from '../sse-client'

type ServedResponse = {
  status: number
  body?: string
  contentType?: string
  /** Hold the stream open until the request aborts, delivering nothing. */
  openEnded?: boolean
}

type RecordedRequest = { authorization: string | null }

const text = (body: string): { status: number; body: string } => ({ status: 200, body })

const startServer = (args: {
  responses: ServedResponse[]
  requests: RecordedRequest[]
}): { url: string; stop: () => void } => {
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      args.requests.push({ authorization: request.headers.get('authorization') })
      const served = args.responses[Math.min(calls, args.responses.length - 1)]
      calls += 1
      if (served === undefined) return new Response('exhausted', { status: 500 })
      if (served.openEnded === true) {
        return new Response(
          new ReadableStream({
            start(controller) {
              if (served.body !== undefined) controller.enqueue(new TextEncoder().encode(served.body))
              request.signal.addEventListener('abort', () => controller.close())
            },
          }),
          { status: served.status, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return new Response(served.body ?? '', {
        status: served.status,
        headers: { 'content-type': served.contentType ?? 'text/event-stream' },
      })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

const frame = (args: { id?: string; event: string; data: unknown }): string =>
  `${args.id === undefined ? '' : `id: ${args.id}\n`}event: ${args.event}\ndata: ${JSON.stringify(args.data)}\n\n`

const collect = () => {
  const frames: { id: string | undefined; event: string; data: string }[] = []
  let drops = 0
  return {
    frames,
    drops: () => drops,
    handlers: {
      onFrame: (f: { id: string | undefined; event: string; data: string }) => frames.push(f),
      onDrop: () => {
        drops += 1
      },
    },
  }
}

describe('runSseStream', () => {
  let server: { url: string; stop: () => void } | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('delivers frames and sends the bearer token', async () => {
    const requests: RecordedRequest[] = []
    server = startServer({
      responses: [{ status: 200, openEnded: true, body: frame({ event: 'pr-state', data: { n: 1 } }) }],
      requests,
    })

    const { frames, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok-1',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
    })

    const deadline = Date.now() + 5_000
    while (frames.length === 0 && Date.now() < deadline) await Bun.sleep(10)
    controller.abort()
    await running

    expect(frames).toEqual([{ id: undefined, event: 'pr-state', data: '{"n":1}' }])
    expect(requests[0]?.authorization).toBe('Bearer tok-1')
  })

  it('rejects with SseRefused on 401 rather than retrying', async () => {
    const requests: RecordedRequest[] = []
    server = startServer({ responses: [{ status: 401 }, { status: 401 }], requests })

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
    expect(requests).toHaveLength(1)
  })

  it('reconnects after a drop and fires onDrop once per drop', async () => {
    const requests: RecordedRequest[] = []
    server = startServer({
      responses: [
        text(frame({ event: 'pr-state', data: { n: 1 } })),
        { status: 200, openEnded: true },
      ],
      requests,
    })

    const { frames, drops, handlers } = collect()
    const controller = new AbortController()
    const running = runSseStream({
      url: server.url,
      token: 'tok',
      clientVersion: 'test',
      signal: controller.signal,
      handlers,
      randomFn: () => 0.01,
    })
    await Bun.sleep(250)
    controller.abort()
    await running

    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(drops()).toBeGreaterThanOrEqual(1)
    expect(frames).toEqual([{ id: undefined, event: 'pr-state', data: '{"n":1}' }])
  })
})
