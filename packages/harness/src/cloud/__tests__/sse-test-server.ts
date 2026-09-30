export type ServedResponse = {
  status: number
  body?: string
  contentType?: string
  /** Hold the stream open until the request aborts, delivering only the initial body. */
  openEnded?: boolean
  /** With openEnded, push a `: keepalive` comment frame on this cadence. */
  heartbeatEveryMs?: number
  /** Accept the connection and never answer with headers at all. */
  hangs?: boolean
}

export type RecordedRequest = { authorization: string | null; clientVersion: string | null }

export type TestServer = {
  url: string
  requests: RecordedRequest[]
  liveStreams: () => number
  stop: () => void
}

export const text = (body: string): { status: number; body: string } => ({ status: 200, body })

export const frame = (args: { id?: string; event: string; data: unknown }): string =>
  `${args.id === undefined ? '' : `id: ${args.id}\n`}event: ${args.event}\ndata: ${JSON.stringify(args.data)}\n\n`

export const startServer = ({ responses }: { responses: ServedResponse[] }): TestServer => {
  let calls = 0
  let live = 0
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get('authorization'),
        clientVersion: request.headers.get('atlas-client-version'),
      })
      const served = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      if (served === undefined) return new Response('exhausted', { status: 500 })
      if (served.hangs === true) return new Promise<Response>(() => {})
      if (served.openEnded === true) {
        // A Bun fetch client does not resolve a streamed response until the first chunk arrives,
        // so a truly empty stream would hang the client under test rather than simulate silence.
        // The leading comment frame carries no event data, so the watchdog still times it out.
        live += 1
        return new Response(
          new ReadableStream({
            start(controller) {
              let heartbeat: ReturnType<typeof setInterval> | undefined
              controller.enqueue(new TextEncoder().encode(served.body ?? ': connected\n\n'))
              if (served.heartbeatEveryMs !== undefined) {
                heartbeat = setInterval(() => {
                  controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
                }, served.heartbeatEveryMs)
              }
              request.signal.addEventListener('abort', () => {
                live -= 1
                if (heartbeat !== undefined) clearInterval(heartbeat)
                controller.close()
              })
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
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    liveStreams: () => live,
    stop: () => server.stop(true),
  }
}

export const collect = () => {
  const frames: { id: string | undefined; event: string; data: string }[] = []
  let drops = 0
  let opens = 0
  return {
    frames,
    drops: () => drops,
    opens: () => opens,
    handlers: {
      onFrame: (f: { id: string | undefined; event: string; data: string }) => frames.push(f),
      onDrop: () => {
        drops += 1
      },
      onOpen: async () => {
        await Bun.sleep(1)
        opens += 1
      },
    },
  }
}

export const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!condition() && Date.now() < deadline) await Bun.sleep(10)
}
