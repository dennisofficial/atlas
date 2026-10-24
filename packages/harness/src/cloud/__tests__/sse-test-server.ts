import { EGithubPrStreamFrame, type GithubPrState } from '@dltech/atlas-wire'

import type { SsePrFrame } from '../sse-types'

export type ServedResponse = {
  status: number
  body?: string
  contentType?: string
  /** Hold the stream open until the request aborts, delivering only the initial body (default: connected + one heartbeat frame). */
  openEnded?: boolean
  /** With openEnded, push a heartbeat data frame on this cadence. */
  heartbeatEveryMs?: number
  /** Accept the connection and never answer with headers at all. */
  hangs?: boolean
}

export type RecordedRequest = {
  authorization: string | null
  clientVersion: string | null
  path: string
}

export type TestServer = {
  url: string
  requests: RecordedRequest[]
  liveStreams: () => number
  stop: () => void
}

export const text = (body: string): { status: number; body: string } => ({ status: 200, body })

export const connected = (): string => 'event: connected\ndata: {}\n\n'

export const dataFrame = (data: unknown): string => `data: ${JSON.stringify(data)}\n\n`

export const heartbeatFrame = (): string => dataFrame({ type: 'heartbeat' })

export const serializedError = (args: {
  code: string
  httpStatus: number
  number: number
}): string =>
  `event: serialized-error\ndata: ${JSON.stringify({
    message: 'failed',
    code: args.number,
    data: { code: args.code, httpStatus: args.httpStatus },
  })}\n\n`

export const returnEvent = (): string => 'event: return\ndata: {}\n\n'

export const opened = (...rest: string[]): string =>
  [connected(), heartbeatFrame(), ...rest].join('')

export const prStateFrame = (state: Partial<GithubPrState> = {}): SsePrFrame => ({
  type: EGithubPrStreamFrame.PrState,
  state: {
    repoFullName: 'owner/repo',
    prNumber: 42,
    title: 'smoke',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    headBranch: 'feature',
    headSha: 'abc',
    checksRunning: 1,
    checksPassed: 0,
    checksFailed: 0,
    mergeable: null,
    updatedAt: '2026-10-24T00:00:00.000Z',
    ...state,
  },
})

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
        path: new URL(request.url).pathname,
      })
      const served = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      if (served === undefined) return new Response('exhausted', { status: 500 })
      if (served.hangs === true) return new Promise<Response>(() => {})
      if (served.openEnded === true) {
        // A Bun fetch client does not resolve a streamed response until the first chunk arrives,
        // so a truly empty stream would hang the client under test rather than simulate silence.
        live += 1
        return new Response(
          new ReadableStream({
            start(controller) {
              let heartbeat: ReturnType<typeof setInterval> | undefined
              controller.enqueue(new TextEncoder().encode(served.body ?? opened()))
              if (served.heartbeatEveryMs !== undefined) {
                heartbeat = setInterval(() => {
                  controller.enqueue(new TextEncoder().encode(heartbeatFrame()))
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
  const frames: SsePrFrame[] = []
  let drops = 0
  let opens = 0
  return {
    frames,
    drops: () => drops,
    opens: () => opens,
    handlers: {
      onFrame: (f: SsePrFrame) => frames.push(f),
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
