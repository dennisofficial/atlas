import { afterEach } from 'bun:test'

import type { Db } from '@dltech/atlas-db'

import { cipher, sealed } from '../../config/__tests__/config-reader.fixture'

export { cipher, sealed }

export const PUBLIC_URL = 'https://agent.byatlas.io'
export const WEB_ORIGIN = 'https://app.byatlas.io'
export const REDIRECT_URI = `${PUBLIC_URL}/mcp-oauth/callback`
export const SERVER_URL = 'https://mcp.example.com/mcp'
export const AUTH_ORIGIN = 'https://auth.example.com'
export const AUTHORIZE_ENDPOINT = `${AUTH_ORIGIN}/authorize`
export const TOKEN_ENDPOINT = `${AUTH_ORIGIN}/token`
export const REGISTRATION_ENDPOINT = `${AUTH_ORIGIN}/register`

export type FetchCall = { url: string; method: string; body: string | undefined }

let restore: (() => void) | undefined

export const stubFetch = (
  handler: (call: FetchCall) => Response | Promise<Response>,
): { calls: FetchCall[] } => {
  const calls: FetchCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  restore = () => {
    globalThis.fetch = original
  }
  return { calls }
}

afterEach(() => {
  restore?.()
  restore = undefined
})

export const json = (
  body: unknown,
  args: { status?: number; headers?: Record<string, string> } = {},
): Response =>
  new Response(JSON.stringify(body), {
    status: args.status ?? 200,
    headers: { 'content-type': 'application/json', ...args.headers },
  })

export const discoveryFetch = (
  args: {
    scopes?: string[]
    resource?: string | null
    registration?: string | null
    protectedResource?: boolean
  } = {},
): ((call: FetchCall) => Response) => {
  const protectedResource = {
    authorization_servers: [AUTH_ORIGIN],
    ...(args.resource === null ? {} : { resource: args.resource ?? SERVER_URL }),
    ...(args.scopes === undefined ? {} : { scopes_supported: args.scopes }),
  }
  const metadata = {
    authorization_endpoint: AUTHORIZE_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    token_endpoint_auth_methods_supported: ['none'],
    ...(args.registration === null
      ? {}
      : { registration_endpoint: args.registration ?? REGISTRATION_ENDPOINT }),
  }
  return (call) => {
    if (call.url === SERVER_URL) {
      return new Response('unauthorized', {
        status: 401,
        headers: { 'www-authenticate': `Bearer resource_metadata="${SERVER_URL}/.well-known"` },
      })
    }
    if (call.url.endsWith('/.well-known/oauth-authorization-server')) {
      return json(metadata)
    }
    if (call.url === REGISTRATION_ENDPOINT) return json({ client_id: 'client-1' })
    if (args.protectedResource === false) return new Response('not found', { status: 404 })
    if (call.url.startsWith(SERVER_URL.slice(0, SERVER_URL.lastIndexOf('/')))) {
      return json(protectedResource)
    }
    return new Response('not found', { status: 404 })
  }
}

export const seedCloudServer = async (args: {
  db: Db
  name: string
  url?: string
  scope?: { userId: string } | { projectId: string }
  sealedSpec?: string
}): Promise<void> => {
  await args.db.orm.public.McpServer.create({
    id: `srv-${args.name}`,
    name: args.name,
    source: 'cloud',
    sealedSpec:
      args.sealedSpec ??
      sealed({
        name: args.name,
        transport: { kind: 'http', url: args.url ?? SERVER_URL },
      }),
    ...(args.scope ?? { userId: 'user-1' }),
  })
}

export const grantOf = (args: {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}): Record<string, unknown> => ({
  clientInfo: { clientId: 'client-1' },
  tokens: {
    accessToken: args.accessToken,
    ...(args.refreshToken === undefined ? {} : { refreshToken: args.refreshToken }),
    ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
  },
  tokenEndpoint: TOKEN_ENDPOINT,
  authMethods: ['none'],
  redirectUri: REDIRECT_URI,
})
