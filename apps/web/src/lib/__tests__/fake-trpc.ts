import { mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import { cloudCall } from '@/lib/api-client'

const liveFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init),
  { preconnect: fetch.preconnect },
)

const installApiClient = (): void => {
  mock.module('@/lib/api-client', () => ({
    api: createApiClient({ baseUrl: '', fetchFn: liveFetch }),
    cloudCall,
  }))
}

installApiClient()

export type TrpcCall = { url: string; method: string; body: unknown }

type Reply = () => Response

let reply: Reply | null = null
let previousFetch: typeof fetch | null = null

export const trpcCalls: TrpcCall[] = []

const dispatcher = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = init?.body
    trpcCalls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    })
    return reply === null ? Response.json({ result: {} }) : reply()
  },
  { preconnect: fetch.preconnect },
)

export const resetTrpc = (): void => {
  trpcCalls.length = 0
  reply = () => Response.json({ result: {} })
  installApiClient()
  previousFetch = globalThis.fetch
  globalThis.fetch = dispatcher
}

export const restoreTrpc = (): void => {
  reply = null
  if (previousFetch !== null) globalThis.fetch = previousFetch
  previousFetch = null
}

export const answerTrpc = (next: Reply): void => {
  reply = next
}

export const trpcData = (data: unknown): Response => Response.json({ result: { data } })

export const trpcVoid = (): Response => Response.json({ result: {} })

export const trpcFailure = (args: {
  status: number
  rpcCode: number
  name: string
  path: string
  message: string
  detailsCode: string
}): Response =>
  Response.json(
    {
      error: {
        message: args.message,
        code: args.rpcCode,
        data: {
          code: args.name,
          httpStatus: args.status,
          path: args.path,
          details: { message: args.message, code: args.detailsCode },
        },
      },
    },
    { status: args.status },
  )
