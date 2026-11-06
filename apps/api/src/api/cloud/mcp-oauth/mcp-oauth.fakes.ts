import { EMcpServerSource } from '@dltech/atlas-wire'
import {
  EGrantRowStatus,
  McpOauthClock,
  McpOauthConfig,
  McpOauthFetcher,
  McpOauthStore,
} from './mcp-oauth.types'
import type { AttemptFence, PendingRow, ServerGrantRow } from './mcp-oauth.types'

const REPO_SEEN_BUMP_MS = 3_600_000

const grantKey = (row: Pick<ServerGrantRow, 'userId' | 'projectId'>): string =>
  row.userId ?? row.projectId ?? ''

export class FakeMcpStore implements McpOauthStore {
  readonly pendings = new Map<string, PendingRow>()
  readonly servers = new Map<string, ServerGrantRow>()
  readonly projectOwners = new Map<string, string>()
  private nextId = 1

  async insertPending(row: PendingRow) {
    this.pendings.set(row.id, row)
  }

  async takePending(args: { id: string }) {
    const row = this.pendings.get(args.id) ?? null
    this.pendings.delete(args.id)
    return row
  }

  async findServer(args: { id: string }) {
    const row = this.servers.get(args.id)
    return row === undefined ? null : { ...row }
  }

  async listServers(args: { userId?: string | undefined; projectId?: string | undefined }) {
    const scopeKey = args.projectId ?? args.userId ?? ''
    return [...this.servers.values()]
      .filter((row) => grantKey(row) === scopeKey)
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
      )
      .map((row) => ({ ...row }))
  }

  async findByName(args: {
    userId?: string | undefined
    projectId?: string | undefined
    source: EMcpServerSource
    name: string
  }) {
    const scopeKey = args.projectId ?? args.userId ?? ''
    const row = [...this.servers.values()].find(
      (entry) =>
        grantKey(entry) === scopeKey && entry.source === args.source && entry.name === args.name,
    )
    return row === undefined ? null : { ...row }
  }

  async touchRepoServer(args: {
    userId?: string | undefined
    projectId?: string | undefined
    name: string
    url: string
    now: Date
  }) {
    const existing = await this.findByName({
      userId: args.userId,
      projectId: args.projectId,
      source: EMcpServerSource.Repo,
      name: args.name,
    })
    if (existing === null) {
      const row: ServerGrantRow = {
        id: `server-${this.nextId++}`,
        userId: args.userId ?? null,
        projectId: args.projectId ?? null,
        name: args.name,
        source: EMcpServerSource.Repo,
        sealedSpec: null,
        repoUrl: args.url,
        lastSeenAt: args.now,
        oauthServerUrl: null,
        oauthSealed: null,
        oauthStatus: null,
        oauthGeneration: 0,
        oauthRefreshAttempt: null,
        oauthRefreshStartedAt: null,
        oauthUpdatedAt: null,
      }
      this.servers.set(row.id, row)
      return { ...row }
    }
    const row = this.servers.get(existing.id)
    if (row === undefined) throw new Error('repo server vanished')
    if (row.repoUrl !== args.url) row.repoUrl = args.url
    if (
      row.lastSeenAt !== null &&
      row.lastSeenAt.getTime() < args.now.getTime() - REPO_SEEN_BUMP_MS
    )
      row.lastSeenAt = args.now
    return { ...row }
  }

  async projectOwner(args: { projectId: string }) {
    return this.projectOwners.get(args.projectId) ?? null
  }

  async writeGrant(args: { id: string; serverUrl: string; sealed: string }) {
    const row = this.servers.get(args.id)
    if (row === undefined) return
    Object.assign(row, {
      oauthServerUrl: args.serverUrl,
      oauthSealed: args.sealed,
      oauthStatus: EGrantRowStatus.Active,
      oauthGeneration: row.oauthGeneration + 1,
      oauthRefreshAttempt: null,
      oauthRefreshStartedAt: null,
      oauthUpdatedAt: new Date(0),
    })
  }

  private fenced(fence: AttemptFence): ServerGrantRow | undefined {
    const row = this.servers.get(fence.id)
    return row?.oauthGeneration === fence.generation && row.oauthRefreshAttempt === fence.attemptId
      ? row
      : undefined
  }

  async claim(args: { id: string; generation: number; attemptId: string; startedAt: Date }) {
    const row = this.servers.get(args.id)
    if (row === undefined || row.oauthGeneration !== args.generation) return false
    if (row.oauthStatus !== EGrantRowStatus.Active) return false
    row.oauthRefreshAttempt = args.attemptId
    row.oauthRefreshStartedAt = args.startedAt
    return true
  }

  async complete(args: AttemptFence & { sealed: string }) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, {
      oauthSealed: args.sealed,
      oauthGeneration: row.oauthGeneration + 1,
      oauthRefreshAttempt: null,
      oauthRefreshStartedAt: null,
      oauthUpdatedAt: new Date(0),
    })
    return true
  }

  async release(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, { oauthRefreshAttempt: null, oauthRefreshStartedAt: null })
    return true
  }

  async reject(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, {
      oauthStatus: EGrantRowStatus.Expired,
      oauthRefreshAttempt: null,
      oauthRefreshStartedAt: null,
    })
    return true
  }

  async clearGrant(args: { id: string }) {
    const row = this.servers.get(args.id)
    if (row === undefined) return
    Object.assign(row, {
      oauthServerUrl: null,
      oauthSealed: null,
      oauthStatus: null,
      oauthRefreshAttempt: null,
      oauthRefreshStartedAt: null,
      oauthUpdatedAt: null,
    })
  }

  async deleteRepoServer(args: { id: string }) {
    const row = this.servers.get(args.id)
    if (row?.source === EMcpServerSource.Repo) this.servers.delete(args.id)
  }
}

export class FakeMcpClock implements McpOauthClock {
  constructor(public current: number) {}
  now() {
    return this.current
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
