export type TrpcCall = {
  procedure: string
  method: string
  path: string
  input: unknown
}

const parseJson = (text: string | null): unknown => {
  if (text === null || text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const trpcCallOf = (args: { input: unknown; init?: RequestInit | undefined }): TrpcCall => {
  const url = new URL(args.input instanceof Request ? args.input.url : String(args.input))
  const method = args.init?.method ?? 'GET'
  const procedure = url.pathname.split('/').at(-1) ?? ''
  const raw = method === 'GET' ? url.searchParams.get('input') : null
  const body = typeof args.init?.body === 'string' ? args.init.body : null
  return {
    procedure,
    method,
    path: url.pathname,
    input: parseJson(method === 'GET' ? raw : body),
  }
}

export const trpcData = (data: unknown): Response => Response.json({ result: { data } })

export const trpcVoid = (): Response => Response.json({ result: {} })

export const trpcFailure = (args: {
  status: number
  message?: string
  trpcCode?: string
  details?: Record<string, unknown>
}): Response =>
  Response.json(
    {
      error: {
        message: args.message ?? 'failed',
        code: -32603,
        data: {
          code: args.trpcCode ?? 'INTERNAL_SERVER_ERROR',
          httpStatus: args.status,
          ...(args.details === undefined ? {} : { details: args.details }),
        },
      },
    },
    { status: args.status },
  )
