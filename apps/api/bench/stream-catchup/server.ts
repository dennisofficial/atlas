import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { z } from 'zod'

import type { SessionStream } from '../../src/agent/stream/session-stream'

const SSE_PING_MS = 20_000

export type BenchServer = {
  port: number
  url: string
  close(): Promise<void>
}

const followInput = z.object({
  sessionId: z.string(),
  afterSeq: z.number().optional(),
  afterHash: z.string().optional(),
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
          signal,
        }),
      ),
      list: t.procedure.subscription(({ signal }) =>
        args.stream.list({ userId: args.userId, signal }),
      ),
    }),
  })
}

export const createBenchServer = (args: { stream: SessionStream; userId: string }): BenchServer => {
  const router = createRouter({ stream: args.stream, userId: args.userId })
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: async (request) =>
      fetchRequestHandler({
        endpoint: '/v1/trpc',
        req: request,
        router,
        createContext: () => ({}),
        onError: ({ error }) => {
          if (error.code === 'INTERNAL_SERVER_ERROR') console.error(error)
        },
      }),
  })
  return {
    port: server.port ?? 0,
    url: `http://127.0.0.1:${server.port}`,
    close: async () => {
      await server.stop(true)
    },
  }
}
