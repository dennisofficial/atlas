import { OAuthConnectionsClient } from '../../cloud/oauth-connections-client'

type Connection = {
  access: string
  refresh: string
  generation: number
  authorizationId: string
  provider?: string
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ok = (data: unknown): Response => json(200, { result: { data } })

const failure = (args: { status: number; code: string; message: string }): Response =>
  json(args.status, {
    error: {
      message: args.message,
      code: -32603,
      data: { code: args.code, httpStatus: args.status },
    },
  })

const inputOf = (args: { url: URL; init: RequestInit | undefined }): Record<string, unknown> => {
  if (typeof args.init?.body === 'string') return JSON.parse(args.init.body)
  const raw = args.url.searchParams.get('input')
  return raw === null ? {} : JSON.parse(raw)
}

export const OLD_EXPIRY = '2026-10-05T13:00:00.000Z'
export const NEW_EXPIRY = '2026-10-05T14:00:00.000Z'

export type FakeApi = {
  url: string
  connections: Map<string, Connection>
  calls: string[]
  down: boolean
  fetchFn: typeof fetch
  client: () => OAuthConnectionsClient
}

export const fakeOauthApi = (url = 'https://cloud.test'): FakeApi => {
  const connections = new Map<string, Connection>()
  const calls: string[] = []
  const api: FakeApi = {
    url,
    connections,
    calls,
    down: false,
    fetchFn: Object.assign(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input))
        const method = init?.method ?? 'GET'
        const body = inputOf({ url, init })
        calls.push(`${method} ${url.pathname}`)
        if (api.down) return failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'down' })

        const procedure = url.pathname.replace('/v1/trpc/oauthConnections.', '')
        const id = String(body['connectionId'] ?? '')
        const held = connections.get(id)
        const view = (c: Connection) => ({
          accessToken: c.access,
          expiresAt: c.generation > 0 ? NEW_EXPIRY : OLD_EXPIRY,
          generation: c.generation,
          authorizationId: c.authorizationId,
          extra: 'additive',
        })
        const tokens = body['tokens'] as { accessToken: string; refreshToken: string } | undefined
        const missing = failure({ status: 404, code: 'NOT_FOUND', message: 'none' })

        if (procedure === 'upload' && tokens !== undefined) {
          if (held !== undefined) return ok(view(held))
          const created = {
            access: tokens.accessToken,
            refresh: tokens.refreshToken,
            generation: 0,
            authorizationId: id,
            provider: String(body['provider']),
          }
          connections.set(id, created)
          return ok(view(created))
        }
        if (held === undefined) return missing
        if (procedure === 'get')
          return ok({
            provider: held.provider ?? 'anthropic',
            authorizationId: held.authorizationId,
            generation: held.generation,
          })
        if (procedure === 'reauthorize' && tokens !== undefined) {
          if (held.authorizationId === body['authorizationId']) return ok(view(held))
          if (held.authorizationId !== body['previousAuthorizationId'])
            return failure({ status: 409, code: 'CONFLICT', message: 'stale' })
          held.access = tokens.accessToken
          held.refresh = tokens.refreshToken
          held.generation += 1
          held.authorizationId = String(body['authorizationId'])
          return ok(view(held))
        }
        if (procedure === 'assignSandbox') return ok(null)
        if (procedure === 'accessToken') {
          if (body['rejectedAccessToken'] === held.access) {
            held.access = `${held.access}-rotated`
            held.generation += 1
          }
          return ok(view(held))
        }
        return missing
      },
      { preconnect: () => undefined },
    ),
    client: () => new OAuthConnectionsClient({ url, token: 'fake-session', fetchFn: api.fetchFn }),
  }

  return api
}
