import { OAuthError, refreshAuthorization, type OAuthTokens } from '@dltech/atlas-harness/mcp-oauth'
import { EMcpOauthAccessOutcome, type McpOauthAccessResult } from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import { randomBytes } from 'node:crypto'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { normalizeServerUrl, sealJson, unsealJson } from './mcp-oauth-seal'
import { guardedFetch } from './mcp-oauth-ssrf'
import {
  EGrantRowStatus,
  McpOauthClock,
  McpOauthConfig,
  McpOauthFetcher,
  McpOauthStore,
} from './mcp-oauth.types'
import { sealedGrantSchema } from './mcp-oauth.types'
import type { GrantRow, SealedGrant } from './mcp-oauth.types'

const FRESH_MARGIN_MS = 60_000
const WAIT_BUDGET_MS = 10_000
const WAIT_POLL_MS = 200
const STALE_ATTEMPT_MS = 30_000
const MAX_PASSES = 6
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
  ) {}

  async accessToken(args: {
    userId: string
    serverUrl: string
    rejectedAccessToken?: string | undefined
  }): Promise<McpOauthAccessResult> {
    const serverUrl = normalizeServerUrl(args.serverUrl)
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const row = await this.store.findGrant({
        userId: args.userId,
        serverUrl,
      })
      if (row === null || row.status !== EGrantRowStatus.Active) return needsAuth
      const grant = unsealJson({
        cipher: this.cipher,
        sealed: row.sealed,
        schema: sealedGrantSchema,
      })
      const rejected = args.rejectedAccessToken === grant.tokens.accessToken
      if (!rejected && this.isFresh(grant.tokens)) return this.granted(grant.tokens)

      const attemptRunning =
        row.refreshAttempt !== null &&
        this.clock.now() - (row.refreshStartedAt?.getTime() ?? 0) < STALE_ATTEMPT_MS
      if (attemptRunning) {
        await this.awaitAttempt(row)
        continue
      }
      const outcome = await this.refreshOnce({ row, grant })
      if (outcome !== undefined) return outcome
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'the grant is busy; retry shortly',
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

  private async awaitAttempt(row: GrantRow): Promise<void> {
    const deadline = this.clock.now() + WAIT_BUDGET_MS
    while (this.clock.now() < deadline) {
      await this.clock.sleep(WAIT_POLL_MS)
      const current = await this.store.findGrant({
        userId: row.userId,
        serverUrl: row.serverUrl,
      })
      if (current === null || current.generation !== row.generation) return
      if (current.refreshAttempt !== row.refreshAttempt) return
    }
  }

  private async refreshOnce(args: {
    row: GrantRow
    grant: SealedGrant
  }): Promise<McpOauthAccessResult | undefined> {
    const attemptId = randomBytes(16).toString('hex')
    const nowMs = this.clock.now()
    const claimed = await this.store.claim({
      id: args.row.id,
      generation: args.row.generation,
      attemptId,
      startedAt: new Date(nowMs),
      staleBefore: new Date(nowMs - STALE_ATTEMPT_MS),
    })
    if (!claimed) return undefined
    const fence = {
      id: args.row.id,
      attemptId,
      generation: args.row.generation,
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
        clientId: grant.clientInfo.clientId,
        ...(grant.clientInfo.clientSecret === undefined
          ? {}
          : { clientSecret: grant.clientInfo.clientSecret }),
        ...(grant.authMethods === undefined
          ? {}
          : { tokenEndpointAuthMethodsSupported: grant.authMethods }),
        ...(grant.resource === undefined ? {} : { resource: grant.resource }),
        clock: { now: () => new Date(nowMs).toISOString() },
        fetch: guardedFetch({
          fetcher: this.fetcher,
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
