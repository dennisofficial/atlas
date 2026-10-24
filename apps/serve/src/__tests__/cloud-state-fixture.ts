import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { trpcFailure, trpcOk } from './trpc-fake'

export const SANDBOX_CONFIG_PATH = '/v1/trpc/sandboxConfig.get'

export const sandboxConfigSearch = (projectId: string): string =>
  `?input=${encodeURIComponent(JSON.stringify({ projectId }))}`

const unauthorized = (path: string, text: string): Response =>
  path.startsWith('/v1/trpc/')
    ? trpcFailure({ status: 401, message: text })
    : new Response(text, { status: 401 })

export const SERVE_TOKEN = 'serve-token-fake'

export const apiKeyAccount = (args: {
  id: string
  provider: EAuthProvider
  apiKey: string
  label: string
}) => ({
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
  config?: unknown
}

export type FakeCloud = {
  url: string
  requests: { path: string; search: string; authorization: string | null }[]
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
      const { pathname: path, search } = new URL(request.url)
      const authorization = request.headers.get('authorization')
      requests.push({ path, search, authorization })
      if (authorization !== `Bearer ${SERVE_TOKEN}`) return unauthorized(path, 'unauthorized')
      if (unauthorizedUntil.remaining > 0) {
        unauthorizedUntil.remaining -= 1
        return unauthorized(path, 'not registered yet')
      }
      if (path === '/v1/trpc/accountLease.get') return trpcOk(state.lease)
      if (path === SANDBOX_CONFIG_PATH)
        return state.config === undefined
          ? trpcFailure({ status: 404, message: 'no such procedure' })
          : trpcOk(state.config)
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
