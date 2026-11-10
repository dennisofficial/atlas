import { randomBytes } from 'node:crypto'

import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '../config/secret-cipher'
import { oauthClientFor } from './client'
import { discoverOauthEndpoints } from './discovery'
import { OAuthError } from './errors'
import { generatePkce } from './pkce'
import { returnPathOf } from './redirect'
import { normalizeServerUrl, sealJson, unsealJson } from './seal'
import { serverUrlOf } from './server-url'
import { guardedFetch, SsrfRejectedError, type HostResolver } from './ssrf'
import { McpOauthStore } from './store'
import { refreshAuthorization } from './token'
import { buildAuthorizationUrl } from './token'
import {
  sealedGrantSchema,
  type McpOauthBegin,
  type McpOauthBeginArgs,
  type McpOauthGateway,
  type McpOauthGrant,
  type McpOauthServerRef,
  type McpServerGrantRow,
  type OAuthFetch,
  type OAuthTokens,
  type SealedGrant,
  type SealedPending,
} from './types'

const PENDING_TTL_MS = 10 * 60_000
const FRESH_MARGIN_MS = 60_000
const REFRESH_PASSES = 40
const REFRESH_POLL_MS = 25
const STALE_ATTEMPT_MS = 30_000
const REJECTING_STATUSES = [400, 401]

export type McpOauthGatewayArgs = {
  db: Db
  cipher: SecretCipher
  publicUrl: string
  fetch?: OAuthFetch | undefined
  now?: (() => number) | undefined
  allowLocalTargets?: boolean | undefined
  resolveHost?: HostResolver | undefined
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const needsSignIn = (): McpOauthGrant => ({
  ok: false,
  reason: 'the server has no usable grant; sign in again',
})

export class McpOauthService implements McpOauthGateway {
  private readonly store: McpOauthStore
  private readonly now: () => number
  private readonly fetcher: OAuthFetch

  constructor(private readonly args: McpOauthGatewayArgs) {
    this.store = new McpOauthStore(args.db)
    this.now = args.now ?? Date.now
    this.fetcher = args.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  get redirectUri(): string {
    return `${new URL(this.args.publicUrl).origin}/mcp-oauth/callback`
  }

  async begin(args: McpOauthBeginArgs): Promise<McpOauthBegin> {
    const resolved = await this.rowFor(args)
    if (!resolved.ok) return resolved
    const serverUrl = this.urlOf(resolved.row)
    if (serverUrl === undefined) {
      return {
        ok: false,
        reason: 'only an http server without its own Authorization header can sign in',
      }
    }
    const fetch = this.guarded()
    try {
      const found = await discoverOauthEndpoints({
        serverUrl,
        fetch,
        allowLocalTargets: this.args.allowLocalTargets ?? false,
      })
      if (!found.supported) return { ok: false, reason: found.reason }
      const clientInfo = await oauthClientFor({
        row: resolved.row,
        cipher: this.args.cipher,
        nowMs: this.now(),
        redirectUri: this.redirectUri,
        tokenEndpoint: found.tokenEndpoint,
        ...(found.registrationEndpoint === undefined
          ? {}
          : { registrationEndpoint: found.registrationEndpoint }),
        ...(found.scope === undefined ? {} : { scope: found.scope }),
        fetch,
      })
      if (clientInfo === undefined) {
        return { ok: false, reason: 'the server offers no dynamic client registration' }
      }
      const pkce = generatePkce()
      const pending: SealedPending = {
        codeVerifier: pkce.verifier,
        clientInfo,
        tokenEndpoint: found.tokenEndpoint,
        redirectUri: this.redirectUri,
        returnTarget: args.returnTarget,
        ...(found.authMethods === undefined ? {} : { authMethods: found.authMethods }),
        ...(found.resource === undefined ? {} : { resource: found.resource }),
      }
      const expiresAt = new Date(this.now() + PENDING_TTL_MS)
      await this.store.insertPending({
        id: pkce.state,
        userId: args.userId,
        serverUrl,
        sealed: sealJson({ cipher: this.args.cipher, value: pending }),
        returnTo: returnPathOf(args.returnTarget.screen),
        surface: args.returnTarget.surface,
        expiresAt,
        mcpServerId: resolved.row.id,
      })
      return {
        ok: true,
        url: buildAuthorizationUrl({
          authorizationEndpoint: found.authorizationEndpoint,
          clientId: clientInfo.clientId,
          redirectUri: this.redirectUri,
          pkce,
          ...(found.scope === undefined ? {} : { scope: found.scope }),
          ...(found.resource === undefined ? {} : { resource: found.resource }),
        }),
        expiresAt: expiresAt.toISOString(),
      }
    } catch (error) {
      if (error instanceof SsrfRejectedError || error instanceof OAuthError) {
        return { ok: false, reason: error.message }
      }
      return { ok: false, reason: `could not reach the server: ${String(error)}`.slice(0, 200) }
    }
  }

  async refresh(args: McpOauthServerRef): Promise<McpOauthGrant> {
    const resolved = await this.rowFor(args)
    if (!resolved.ok) return resolved
    for (let pass = 0; pass < REFRESH_PASSES; pass += 1) {
      const row = pass === 0 ? resolved.row : await this.store.find({ id: resolved.row.id })
      if (row === null) return needsSignIn()
      const grant = this.activeGrant({ row, serverUrl: this.urlOf(row) })
      if (grant === null) return needsSignIn()
      if (this.isFresh(grant.tokens)) return this.granted(grant.tokens)
      if (this.attemptLive(row)) {
        await sleep(REFRESH_POLL_MS)
        continue
      }
      const outcome = await this.refreshOnce({ row, grant })
      if (outcome !== undefined) return outcome
      await sleep(REFRESH_POLL_MS)
    }
    return { ok: false, reason: 'another refresh is in flight; retry shortly' }
  }

  private async rowFor(
    args: McpOauthServerRef,
  ): Promise<{ ok: true; row: McpServerGrantRow } | { ok: false; reason: string }> {
    if (args.source === 'repo') {
      if (args.projectId === undefined) return { ok: false, reason: 'mcp server not found' }
      const row = await this.store.touchRepoServer({
        projectId: args.projectId,
        name: args.name,
        url: normalizeServerUrl(args.url),
        now: new Date(this.now()),
      })
      return { ok: true, row }
    }
    const scoped =
      args.projectId === undefined
        ? null
        : await this.store.findByName({
            projectId: args.projectId,
            source: 'cloud',
            name: args.name,
          })
    const row =
      scoped ??
      (await this.store.findByName({ userId: args.userId, source: 'cloud', name: args.name }))
    return row === null ? { ok: false, reason: 'mcp server not found' } : { ok: true, row }
  }

  private urlOf(row: McpServerGrantRow): string | undefined {
    try {
      return serverUrlOf({ cipher: this.args.cipher, row })
    } catch {
      return undefined
    }
  }

  private activeGrant(args: {
    row: McpServerGrantRow
    serverUrl: string | undefined
  }): SealedGrant | null {
    const { row } = args
    if (
      row.oauthStatus !== 'active' ||
      row.oauthSealed === null ||
      args.serverUrl === undefined ||
      row.oauthServerUrl !== args.serverUrl
    ) {
      return null
    }
    try {
      return unsealJson({
        cipher: this.args.cipher,
        sealed: row.oauthSealed,
        schema: sealedGrantSchema,
      })
    } catch {
      return null
    }
  }

  private attemptLive(row: McpServerGrantRow): boolean {
    if (row.oauthRefreshAttempt === null) return false
    const startedMs = row.oauthRefreshStartedAt?.getTime() ?? 0
    return this.now() - startedMs < STALE_ATTEMPT_MS
  }

  private isFresh(tokens: OAuthTokens): boolean {
    if (tokens.expiresAt === undefined) return true
    return Date.parse(tokens.expiresAt) > this.now() + FRESH_MARGIN_MS
  }

  private granted(tokens: OAuthTokens): McpOauthGrant {
    return {
      ok: true,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt === undefined ? null : tokens.expiresAt,
    }
  }

  private async refreshOnce(args: {
    row: McpServerGrantRow
    grant: SealedGrant
  }): Promise<McpOauthGrant | undefined> {
    const attemptId = randomBytes(16).toString('hex')
    const fence = { id: args.row.id, attemptId, generation: args.row.oauthGeneration }
    const claimed = await this.store.claim({
      ...fence,
      startedAt: new Date(this.now()),
    })
    if (!claimed) return undefined
    const refreshToken = args.grant.tokens.refreshToken
    if (refreshToken === undefined) {
      await this.store.reject(fence)
      return needsSignIn()
    }
    try {
      const tokens = await refreshAuthorization({
        tokenEndpoint: args.grant.tokenEndpoint,
        refreshToken,
        client: args.grant.clientInfo,
        ...(args.grant.authMethods === undefined ? {} : { authMethods: args.grant.authMethods }),
        ...(args.grant.resource === undefined ? {} : { resource: args.grant.resource }),
        nowMs: this.now(),
        fetch: this.guarded(),
      })
      const stored = await this.store.complete({
        ...fence,
        sealed: sealJson({ cipher: this.args.cipher, value: { ...args.grant, tokens } }),
      })
      return stored ? this.granted(tokens) : undefined
    } catch (error) {
      if (
        error instanceof OAuthError &&
        (error.code === 'invalid_grant' ||
          (error.status !== undefined && REJECTING_STATUSES.includes(error.status)))
      ) {
        await this.store.reject(fence)
        return needsSignIn()
      }
      await this.store.release(fence)
      return {
        ok: false,
        reason: 'the authorization server is unavailable; retry shortly',
      }
    }
  }

  private guarded(): OAuthFetch {
    return guardedFetch({
      fetch: this.fetcher,
      allowLocalTargets: this.args.allowLocalTargets ?? false,
      resolveHost: this.args.resolveHost,
    })
  }
}

export const mcpOauthGatewayOf = (args: McpOauthGatewayArgs): McpOauthGateway =>
  new McpOauthService(args)
