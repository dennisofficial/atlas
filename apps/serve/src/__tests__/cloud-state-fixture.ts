import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

export const SERVE_TOKEN = 'serve-token-fake'

export const apiKeyAccount = (args: { id: string; provider: EAuthProvider; apiKey: string; label: string }) => ({
  id: args.id,
  provider: args.provider,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: args.label,
  status: EAccountStatus.Active,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey },
})

export const oauthAccount = (args: { id: string; connectionId: string }) => ({
  id: args.id,
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'Claude subscription',
  status: EAccountStatus.Active,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  secret: {
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'fake-access', refreshToken: '', expiresAt: '2099-01-01T00:00:00.000Z' },
    authority: { url: 'https://cloud.test', connectionId: args.connectionId },
  },
})

export type FakeCloudState = {
  lease: unknown
  settings: { key: string; value: string }[]
  secrets: { name: string; value: string }[]
}

export type FakeCloud = {
  url: string
  requests: { path: string; authorization: string | null }[]
  unauthorizedUntil: { remaining: number }
  stop: () => Promise<void>
}

export const startFakeCloud = (state: FakeCloudState): FakeCloud => {
  const requests: FakeCloud['requests'] = []
  const unauthorizedUntil = { remaining: 0 }
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const path = new URL(request.url).pathname
      const authorization = request.headers.get('authorization')
      requests.push({ path, authorization })
      if (authorization !== `Bearer ${SERVE_TOKEN}`) return new Response('unauthorized', { status: 401 })
      if (unauthorizedUntil.remaining > 0) {
        unauthorizedUntil.remaining -= 1
        return new Response('not registered yet', { status: 401 })
      }
      if (path === '/v1/account-lease') return Response.json(state.lease)
      if (path === '/v1/settings') return Response.json({ settings: state.settings })
      if (path === '/v1/secrets') return Response.json({ secrets: state.secrets })
      return new Response('not found', { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    unauthorizedUntil,
    stop: async () => {
      await server.stop(true)
    },
  }
}
