export type TrpcCall = { url: string; method: string; body: unknown }

type Reply = () => Response

const realFetch = globalThis.fetch

let reply: Reply | null = null

export const trpcCalls: TrpcCall[] = []

const dispatcher = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (reply === null) return realFetch(input, init)
    const raw = init?.body
    trpcCalls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    })
    return reply()
  },
  { preconnect: realFetch.preconnect },
)

globalThis.fetch = dispatcher

export const resetTrpc = (): void => {
  trpcCalls.length = 0
  reply = () => Response.json({ result: {} })
}

export const restoreTrpc = (): void => {
  reply = null
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
