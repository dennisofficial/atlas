import { EDefinitionOrigin } from '@dltech/atlas-core'
import {
  EMcpOauthAccessOutcome,
  EMcpServerSource,
  mcpOauthAccessResultSchema,
  type McpOauthAccessInput,
} from '@dltech/atlas-wire/web'

import type { McpTokenSource, McpTokenTarget } from '../bridge/token-source'

const EXPIRY_SKEW_MS = 60_000
const MAX_UNDATED_TTL_MS = 5 * 60_000
const FAILURE_TTL_MS = 60_000

export type McpOauthAccessCall = (args: McpOauthAccessInput) => Promise<unknown>

type Cached = { accessToken: string; expiresAtMs: number; url: string }

const sourceOfOrigin = (origin: EDefinitionOrigin): EMcpServerSource | undefined => {
  if (origin === EDefinitionOrigin.Project) return EMcpServerSource.Repo
  if (origin === EDefinitionOrigin.User) return EMcpServerSource.Cloud
  return undefined
}

export class CloudMcpTokenSource implements McpTokenSource {
  private readonly cache = new Map<string, Cached>()
  private readonly rejected = new Map<string, string>()
  private readonly failedUntil = new Map<string, number>()

  constructor(private readonly args: { access: McpOauthAccessCall; nowMs?: () => number }) {}

  async currentToken(args: { server: McpTokenTarget }): Promise<string | undefined> {
    const source = sourceOfOrigin(args.server.origin)
    if (source === undefined) return undefined
    const key = `${source}:${args.server.name}`
    const now = this.now()
    if ((this.failedUntil.get(key) ?? 0) > now) return undefined
    const cached = this.cache.get(key)
    if (
      cached !== undefined &&
      cached.url === args.server.url &&
      cached.expiresAtMs - EXPIRY_SKEW_MS > now
    ) {
      return cached.accessToken
    }

    const rejectedAccessToken = this.rejected.get(key)
    try {
      const raw = await this.args.access({
        name: args.server.name,
        source,
        url: args.server.url,
        ...(rejectedAccessToken === undefined ? {} : { rejectedAccessToken }),
      })
      const parsed = mcpOauthAccessResultSchema.safeParse(raw)
      if (!parsed.success || parsed.data.outcome === EMcpOauthAccessOutcome.NeedsAuth) {
        return this.fail(key)
      }
      const dated =
        parsed.data.expiresAt === undefined ? Number.NaN : Date.parse(parsed.data.expiresAt)
      this.rejected.delete(key)
      this.cache.set(key, {
        accessToken: parsed.data.accessToken,
        expiresAtMs: Number.isNaN(dated) ? this.now() + MAX_UNDATED_TTL_MS : dated,
        url: args.server.url,
      })
      return parsed.data.accessToken
    } catch {
      return this.fail(key)
    }
  }

  reject(args: { server: McpTokenTarget; token: string }): void {
    const source = sourceOfOrigin(args.server.origin)
    if (source === undefined) return
    const key = `${source}:${args.server.name}`
    const cached = this.cache.get(key)
    if (cached !== undefined && cached.accessToken !== args.token) return
    this.cache.delete(key)
    this.rejected.set(key, args.token)
  }

  clearFailures(): void {
    this.failedUntil.clear()
  }

  private fail(key: string): undefined {
    this.cache.delete(key)
    this.failedUntil.set(key, this.now() + FAILURE_TTL_MS)
    return undefined
  }

  private now(): number {
    return (this.args.nowMs ?? Date.now)()
  }
}
