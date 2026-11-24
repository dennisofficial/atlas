import { Readable } from 'node:stream'
import { constants, createGzip, type Gzip } from 'node:zlib'

import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { z } from 'zod'

import type { SessionStream } from '../../src/agent/stream/session-stream'

const SSE_PING_MS = 20_000
const EVENT_STREAM = 'text/event-stream'
const GZIP = 'gzip'

export type BenchServer = {
  port: number
  url: string
  close(): Promise<void>
}

const followInput = z.object({
  sessionId: z.string(),
  afterSeq: z.number().optional(),
  afterHash: z.string().optional(),
  tailViewVersion: z.number().int().optional(),
})

export type BenchRouter = ReturnType<typeof createRouter>

const createRouter = (args: { stream: SessionStream; userId: string }) => {
  const t = initTRPC.create({ sse: { ping: { enabled: true, intervalMs: SSE_PING_MS } } })
  return t.router({
    sessionStream: t.router({
      follow: t.procedure.input(followInput).subscription(({ input, signal }) =>
        args.stream.follow({
          userId: args.userId,
          sessionId: input.sessionId,
          afterSeq: input.afterSeq,
          afterHash: input.afterHash,
          tailViewVersion: input.tailViewVersion,
          signal,
        }),
      ),
      list: t.procedure.subscription(({ signal }) =>
        args.stream.list({ userId: args.userId, signal }),
      ),
    }),
  })
}

const writeAndFlush = (gzip: Gzip, chunk: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    gzip.write(chunk, (writeError) => {
      if (writeError !== null && writeError !== undefined) {
        reject(writeError)
        return
      }
      gzip.flush(constants.Z_SYNC_FLUSH, () => resolve())
    })
  })

const gzipBody = (body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
  const gzip = createGzip()
  const reader = body.getReader()
  void (async () => {
    try {
      for (;;) {
        const step = await reader.read()
        if (step.done) break
        await writeAndFlush(gzip, step.value)
      }
      gzip.end()
    } catch (error) {
      gzip.destroy(error instanceof Error ? error : undefined)
      await reader.cancel(error).catch(() => undefined)
    }
  })()
  return Readable.toWeb(gzip)
}

const compressible = (request: Request, response: Response): boolean =>
  (request.headers.get('accept-encoding') ?? '').toLowerCase().includes(GZIP) &&
  (response.headers.get('content-type') ?? '').startsWith(EVENT_STREAM)

export const createBenchServer = (args: {
  stream: SessionStream
  userId: string
  gzip?: boolean | undefined
}): BenchServer => {
  const router = createRouter({ stream: args.stream, userId: args.userId })
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: async (request) => {
      const response = await fetchRequestHandler({
        endpoint: '/v1/trpc',
        req: request,
        router,
        createContext: () => ({}),
        onError: ({ error }) => {
          if (error.code === 'INTERNAL_SERVER_ERROR') console.error(error)
        },
      })
      if (args.gzip === false || response.body === null || !compressible(request, response)) {
        return response
      }
      const headers = new Headers(response.headers)
      headers.set('content-encoding', GZIP)
      headers.delete('content-length')
      return new Response(gzipBody(response.body), { status: response.status, headers })
    },
  })
  return {
    port: server.port ?? 0,
    url: `http://127.0.0.1:${server.port}`,
    close: async () => {
      await server.stop(true)
    },
  }
}
