import { mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import { cloudCall } from '@/lib/api-client'

const liveFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init),
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  api: createApiClient({ baseUrl: '', fetchFn: liveFetch }),
  cloudCall,
}))

export type SeenCall = { url: string; method: string; body: unknown }

export const trpcOk = (data: unknown): Response => Response.json({ result: { data } })

export const trpcFailure = (args: {
  status: number
  message?: string
  details?: Record<string, unknown>
}): Response =>
  Response.json(
    {
      error: {
        message: args.message ?? 'failed',
        code: -32603,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          httpStatus: args.status,
          ...(args.details === undefined ? {} : { details: args.details }),
        },
      },
    },
    { status: args.status },
  )

export const queryUrl = (args: { procedure: string; input: unknown }): string =>
  `/v1/trpc/${args.procedure}?input=${encodeURIComponent(JSON.stringify(args.input))}`

export const mutationUrl = (procedure: string): string => `/v1/trpc/${procedure}`

export const fakeFetch = (reply: () => Response): SeenCall[] => {
  const calls: SeenCall[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return reply()
  }) as typeof fetch
  return calls
}
