import { OAuthConnectionsClient } from '../../cloud/oauth-connections-client'

type Connection = { access: string; refresh: string; generation: number; authorizationId: string; provider?: string }

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
        const path = new URL(String(input)).pathname
        const method = init?.method ?? 'GET'
        const body: Record<string, unknown> =
          typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        calls.push(`${method} ${path}`)
        if (api.down) return json(503, { message: 'down' })

        const [, , , rawId, action] = path.split('/')
        const id = decodeURIComponent(rawId ?? '')
        const held = connections.get(id)
        const view = (c: Connection) => ({
          accessToken: c.access,
          expiresAt: c.generation > 0 ? NEW_EXPIRY : OLD_EXPIRY,
          generation: c.generation,
          authorizationId: c.authorizationId,
          extra: 'additive',
        })
        const tokens = body['tokens'] as { accessToken: string; refreshToken: string } | undefined

        if (action === undefined && method === 'PUT' && tokens !== undefined) {
          if (held !== undefined) return json(200, view(held))
          const created = { access: tokens.accessToken, refresh: tokens.refreshToken, generation: 0, authorizationId: id, provider: String(body['provider']) }
          connections.set(id, created)
          return json(200, view(created))
        }
        if (held === undefined) return json(404, { message: 'none' })
        if (action === undefined && method === 'GET') return json(200, {
          provider: held.provider ?? 'anthropic', authorizationId: held.authorizationId, generation: held.generation,
        })
        if (action === 'reauthorize' && tokens !== undefined) {
          if (held.authorizationId === body['authorizationId']) return json(200, view(held))
          if (held.authorizationId !== body['previousAuthorizationId']) return json(409, { message: 'stale' })
          held.access = tokens.accessToken
          held.refresh = tokens.refreshToken
          held.generation += 1
          held.authorizationId = String(body['authorizationId'])
          return json(200, view(held))
        }
        if (action === 'sandboxes' && method === 'PUT') return json(200, {})
        if (action === 'access-token') {
          if (body['rejectedAccessToken'] === held.access) {
            held.access = `${held.access}-rotated`
            held.generation += 1
          }
          return json(200, view(held))
        }
        return json(404, { message: 'none' })
      },
      { preconnect: () => undefined },
    ),
    client: () =>
      new OAuthConnectionsClient({ url, token: 'fake-session', fetchFn: api.fetchFn }),
  }

  return api
}
