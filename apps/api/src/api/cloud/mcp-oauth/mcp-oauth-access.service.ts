import {
  EMcpServerSource,
  EMcpOauthAccessOutcome,
  type McpOauthAccessResult,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import { randomBytes } from 'node:crypto'
import {
  guardedFetch,
  normalizeServerUrl,
  OAuthError,
  refreshAuthorization,
  sealedGrantSchema,
  sealJson,
  unsealJson,
  type OAuthTokens,
  type SealedGrant,
} from '../../../agent'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { RefreshLock } from '../../../_lib/refresh-lock/refresh-lock'
import {
  EGrantRowStatus,
  McpOauthClock,
  McpOauthConfig,
  McpOauthFetcher,
  McpOauthStore,
} from './mcp-oauth.types'
import type { ServerGrantRow } from './mcp-oauth.types'

const FRESH_MARGIN_MS = 60_000
const REJECTING_STATUSES = [400, 401]

const needsAuth: McpOauthAccessResult = {
  outcome: EMcpOauthAccessOutcome.NeedsAuth,
}

@Injectable()
export class McpOauthAccessService {
  constructor(
    private readonly store: McpOauthStore,
    private readonly cipher: SecretCipherService,
    private readonly clock: McpOauthClock,
    private readonly fetcher: McpOauthFetcher,
    private readonly config: McpOauthConfig,
    private readonly lock: RefreshLock,
  ) {}

  async accessToken(args: {
    userId: string
    name: string
    source: EMcpServerSource
    url: string
    rejectedAccessToken?: string | undefined
  }): Promise<McpOauthAccessResult> {
    const url = normalizeServerUrl(args.url)
    const row = await this.resolveRow({ ...args, url })
    const grant = row === null ? null : this.activeGrant({ row, url })
    if (row === null || grant === null) return needsAuth
    if (!this.isRejected({ grant, args }) && this.isFresh(grant.tokens)) {
      return this.granted(grant.tokens)
    }
    return this.lock.run({
      key: `mcp-oauth-refresh:${row.id}`,
      work: () => this.refreshLocked({ id: row.id, url, rejected: args.rejectedAccessToken }),
    })
  }

  private activeGrant(args: { row: ServerGrantRow; url: string }): SealedGrant | null {
    const { row } = args
    if (
      row.oauthStatus !== EGrantRowStatus.Active ||
      row.oauthServerUrl !== args.url ||
      row.oauthSealed === null
    ) {
      return null
    }
    return unsealJson({ cipher: this.cipher, sealed: row.oauthSealed, schema: sealedGrantSchema })
  }

  private isRejected(args: {
    grant: SealedGrant
    args: { rejectedAccessToken?: string | undefined }
  }): boolean {
    return args.args.rejectedAccessToken === args.grant.tokens.accessToken
  }

  private async refreshLocked(args: {
    id: string
    url: string
    rejected: string | undefined
  }): Promise<McpOauthAccessResult> {
    const current = await this.store.findServer({ id: args.id })
    const grant = current === null ? null : this.activeGrant({ row: current, url: args.url })
    if (current === null || grant === null) return needsAuth
    const rejected = args.rejected === grant.tokens.accessToken
    if (!rejected && this.isFresh(grant.tokens)) return this.granted(grant.tokens)
    const outcome = await this.refreshOnce({ row: current, grant })
    if (outcome !== undefined) return outcome
    return this.afterLostFence(args)
  }

  private async afterLostFence(args: {
    id: string
    url: string
    rejected: string | undefined
  }): Promise<McpOauthAccessResult> {
    const current = await this.store.findServer({ id: args.id })
    const grant = current === null ? null : this.activeGrant({ row: current, url: args.url })
    if (grant === null) return needsAuth
    if (args.rejected !== grant.tokens.accessToken && this.isFresh(grant.tokens)) {
      return this.granted(grant.tokens)
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'the grant changed during refresh; retry shortly',
    })
  }

  private async resolveRow(args: {
    userId: string
    name: string
    source: EMcpServerSource
    url: string
  }): Promise<ServerGrantRow | null> {
    if (args.source === EMcpServerSource.Cloud) {
      return this.store.findByName({
        userId: args.userId,
        source: EMcpServerSource.Cloud,
        name: args.name,
      })
    }
    return this.store.touchRepoServer({
      userId: args.userId,
      name: args.name,
      url: args.url,
      now: new Date(this.clock.now()),
    })
  }

  private isFresh(tokens: OAuthTokens): boolean {
    if (tokens.expiresAt === undefined) return true
    return Date.parse(tokens.expiresAt) > this.clock.now() + FRESH_MARGIN_MS
  }

  private granted(tokens: OAuthTokens): McpOauthAccessResult {
    return {
      outcome: EMcpOauthAccessOutcome.Granted,
      accessToken: tokens.accessToken,
      ...(tokens.expiresAt === undefined ? {} : { expiresAt: tokens.expiresAt }),
    }
  }

  private async refreshOnce(args: {
    row: ServerGrantRow
    grant: SealedGrant
  }): Promise<McpOauthAccessResult | undefined> {
    const attemptId = randomBytes(16).toString('hex')
    const nowMs = this.clock.now()
    const claimed = await this.store.claim({
      id: args.row.id,
      generation: args.row.oauthGeneration,
      attemptId,
      startedAt: new Date(nowMs),
    })
    if (!claimed) return undefined
    const fence = {
      id: args.row.id,
      attemptId,
      generation: args.row.oauthGeneration,
    }
    const { grant } = args

    if (grant.tokens.refreshToken === undefined) {
      await this.store.reject(fence)
      return needsAuth
    }
    try {
      const tokens = await refreshAuthorization({
        tokenEndpoint: grant.tokenEndpoint,
        refreshToken: grant.tokens.refreshToken,
        client: grant.clientInfo,
        authMethods: grant.authMethods,
        resource: grant.resource,
        nowMs,
        fetch: guardedFetch({
          fetch: (input, init) => this.fetcher.fetch(input, init),
          allowLocalTargets: this.config.allowLocalTargets,
          resolveHost: this.config.resolveHost,
        }),
      })
      const stored = await this.store.complete({
        ...fence,
        sealed: sealJson({ cipher: this.cipher, value: { ...grant, tokens } }),
      })
      return stored ? this.granted(tokens) : undefined
    } catch (error) {
      if (
        error instanceof OAuthError &&
        (error.code === 'invalid_grant' ||
          (error.status !== undefined && REJECTING_STATUSES.includes(error.status)))
      ) {
        await this.store.reject(fence)
        return needsAuth
      }
      await this.store.release(fence)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'the authorization server is unavailable; retry shortly',
      })
    }
  }
}
