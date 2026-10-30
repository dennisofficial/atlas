import { EMcpOauthAccessOutcome, mcpOauthAccessResultSchema } from '@dltech/atlas-wire/web'

import type { McpTokenSource } from '../bridge/token-source'

const EXPIRY_SKEW_MS = 60_000
const MAX_UNDATED_TTL_MS = 5 * 60_000
const FAILURE_TTL_MS = 60_000

export type McpOauthAccessCall = (args: {
  serverUrl: string
  rejectedAccessToken?: string | undefined
}) => Promise<unknown>

type Cached = { accessToken: string; expiresAtMs: number }

export class CloudMcpTokenSource implements McpTokenSource {
  private readonly cache = new Map<string, Cached>()
  private readonly rejected = new Map<string, string>()
  private readonly failedUntil = new Map<string, number>()

  constructor(private readonly args: { access: McpOauthAccessCall; nowMs?: () => number }) {}

  async currentToken(args: { serverUrl: string }): Promise<string | undefined> {
    const now = this.now()
    if ((this.failedUntil.get(args.serverUrl) ?? 0) > now) return undefined
    const cached = this.cache.get(args.serverUrl)
    if (cached !== undefined && cached.expiresAtMs - EXPIRY_SKEW_MS > now) {
      return cached.accessToken
    }

    const rejectedAccessToken = this.rejected.get(args.serverUrl)
    try {
      const raw = await this.args.access({
        serverUrl: args.serverUrl,
        ...(rejectedAccessToken === undefined ? {} : { rejectedAccessToken }),
      })
      const parsed = mcpOauthAccessResultSchema.safeParse(raw)
      if (!parsed.success || parsed.data.outcome === EMcpOauthAccessOutcome.NeedsAuth) {
        return this.fail(args.serverUrl)
      }
      const dated =
        parsed.data.expiresAt === undefined ? Number.NaN : Date.parse(parsed.data.expiresAt)
      this.rejected.delete(args.serverUrl)
      this.cache.set(args.serverUrl, {
        accessToken: parsed.data.accessToken,
        expiresAtMs: Number.isNaN(dated) ? this.now() + MAX_UNDATED_TTL_MS : dated,
      })
      return parsed.data.accessToken
    } catch {
      return this.fail(args.serverUrl)
    }
  }

  reject(args: { serverUrl: string; token: string }): void {
    const cached = this.cache.get(args.serverUrl)
    if (cached !== undefined && cached.accessToken !== args.token) return
    this.cache.delete(args.serverUrl)
    this.rejected.set(args.serverUrl, args.token)
  }

  clearFailures(): void {
    this.failedUntil.clear()
  }

  private fail(serverUrl: string): undefined {
    this.cache.delete(serverUrl)
    this.failedUntil.set(serverUrl, this.now() + FAILURE_TTL_MS)
    return undefined
  }

  private now(): number {
    return (this.args.nowMs ?? Date.now)()
  }
}
