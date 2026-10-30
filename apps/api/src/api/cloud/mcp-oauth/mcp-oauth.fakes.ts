import {
  EGrantRowStatus,
  McpOauthClock,
  McpOauthConfig,
  McpOauthFetcher,
  McpOauthStore,
} from './mcp-oauth.types'
import type { AttemptFence, GrantRow, PendingRow } from './mcp-oauth.types'

export class FakeMcpStore implements McpOauthStore {
  readonly pendings = new Map<string, PendingRow>()
  readonly grants = new Map<string, GrantRow>()
  private nextId = 1

  async insertPending(row: PendingRow) {
    this.pendings.set(row.id, row)
  }

  async takePending(args: { id: string }) {
    const row = this.pendings.get(args.id) ?? null
    this.pendings.delete(args.id)
    return row
  }

  async findGrant(args: { userId: string; serverUrl: string }) {
    const row = this.grants.get(`${args.userId}|${args.serverUrl}`)
    return row === undefined ? null : { ...row }
  }

  async findGrants(args: { userId: string; serverUrls: string[] }) {
    return [...this.grants.values()].filter(
      (row) => row.userId === args.userId && args.serverUrls.includes(row.serverUrl),
    )
  }

  async upsertGrant(args: { userId: string; serverUrl: string; sealed: string }) {
    const key = `${args.userId}|${args.serverUrl}`
    const existing = this.grants.get(key)
    this.grants.set(key, {
      id: existing?.id ?? `grant-${this.nextId++}`,
      userId: args.userId,
      serverUrl: args.serverUrl,
      status: EGrantRowStatus.Active,
      sealed: args.sealed,
      generation: existing === undefined ? 0 : existing.generation + 1,
      refreshAttempt: null,
      refreshStartedAt: null,
      updatedAt: new Date(0),
    })
  }

  private byId(id: string): GrantRow | undefined {
    return [...this.grants.values()].find((row) => row.id === id)
  }

  private fenced(fence: AttemptFence): GrantRow | undefined {
    const row = this.byId(fence.id)
    return row?.generation === fence.generation && row.refreshAttempt === fence.attemptId
      ? row
      : undefined
  }

  async claim(args: {
    id: string
    generation: number
    attemptId: string
    startedAt: Date
    staleBefore: Date
  }) {
    const row = this.byId(args.id)
    if (row === undefined || row.generation !== args.generation) return false
    if (row.status !== EGrantRowStatus.Active) return false
    const stale = row.refreshStartedAt !== null && row.refreshStartedAt < args.staleBefore
    if (row.refreshAttempt !== null && !stale) return false
    row.refreshAttempt = args.attemptId
    row.refreshStartedAt = args.startedAt
    return true
  }

  async complete(args: AttemptFence & { sealed: string }) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, {
      sealed: args.sealed,
      generation: row.generation + 1,
      refreshAttempt: null,
      refreshStartedAt: null,
    })
    return true
  }

  async release(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, { refreshAttempt: null, refreshStartedAt: null })
    return true
  }

  async reject(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, {
      status: EGrantRowStatus.Expired,
      refreshAttempt: null,
      refreshStartedAt: null,
    })
    return true
  }

  async deleteGrant(args: { userId: string; serverUrl: string }) {
    this.grants.delete(`${args.userId}|${args.serverUrl}`)
  }
}

export class FakeMcpClock implements McpOauthClock {
  constructor(public current: number) {}
  now() {
    return this.current
  }
  async sleep(ms: number) {
    this.current += ms
  }
}

export const TEST_CONFIG: McpOauthConfig = {
  redirectUri: 'https://api.test/v1/mcp/oauth/callback',
  webOrigin: 'https://web.test',
  allowLocalTargets: false,
  resolveHost: async () => ['93.184.216.34'],
}

type Handler = (request: {
  url: string
  init: RequestInit | undefined
}) => Response | Promise<Response>

export class FakeMcpFetcher implements McpOauthFetcher {
  readonly calls: { url: string; init: RequestInit | undefined }[] = []
  readonly handlers = new Map<string, Handler>()

  on(url: string, handler: Handler) {
    this.handlers.set(url, handler)
  }

  async fetch(input: string, init?: RequestInit) {
    this.calls.push({ url: input, init })
    const handler = this.handlers.get(input)
    if (handler === undefined) return new Response('not found', { status: 404 })
    return handler({ url: input, init })
  }

  callsTo(url: string) {
    return this.calls.filter((call) => call.url === url)
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const SERVER = 'https://mcp.example.com/mcp'
export const AUTH = 'https://auth.example.com'

export const installIssuer = (fetcher: FakeMcpFetcher, extra: { registration?: boolean } = {}) => {
  const registration = extra.registration ?? true
  fetcher.on(
    SERVER,
    () =>
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read"`,
        },
      }),
  )
  fetcher.on('https://mcp.example.com/.well-known/oauth-protected-resource/mcp', () =>
    json({ authorization_servers: [AUTH] }),
  )
  fetcher.on(`${AUTH}/.well-known/oauth-authorization-server`, () =>
    json({
      authorization_endpoint: `${AUTH}/authorize`,
      token_endpoint: `${AUTH}/token`,
      ...(registration ? { registration_endpoint: `${AUTH}/register` } : {}),
      token_endpoint_auth_methods_supported: ['none'],
    }),
  )
  fetcher.on(`${AUTH}/register`, () => json({ client_id: 'client-1' }, 201))
}
