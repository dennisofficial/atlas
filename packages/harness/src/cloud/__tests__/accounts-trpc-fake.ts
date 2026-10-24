export type TrpcCall = { procedure: string; input: unknown }

const TRPC_PREFIX = '/v1/trpc/'

const parsed = (text: string | null): unknown => {
  if (text === null || text === '') return undefined
  return JSON.parse(text)
}

export const isTrpcUrl = (url: string): boolean => new URL(url).pathname.startsWith(TRPC_PREFIX)

export const trpcCallOf = ({ url, body }: { url: string; body?: unknown }): TrpcCall => {
  const target = new URL(url)
  const procedure = target.pathname.slice(TRPC_PREFIX.length)
  const queried = parsed(target.searchParams.get('input'))
  return { procedure, input: queried === undefined ? body : queried }
}

export const trpcData = (data: unknown): Response => Response.json({ result: { data } })

export const trpcError = ({ status, message }: { status: number; message: string }): Response =>
  Response.json(
    { error: { message, code: -32603, data: { code: 'ERROR', httpStatus: status } } },
    { status },
  )
