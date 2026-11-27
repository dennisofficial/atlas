import { randomBytes } from 'node:crypto'

import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import type { BrowserReturnService } from '../browser-return/service'
import { MCP_OAUTH_CALLBACK_PATH } from './callback-path'
import { oauthClientFor } from './client'
import { discoverOauthEndpoints } from './discovery'
import { OAuthError } from './errors'
import { attemptLiveOf, freshTokensOf, grantedOf } from './grant-state'
import { generatePkce } from './pkce'
import { returnPathOf } from './redirect'
import { normalizeServerUrl, sameServerUrl, sealJson, unsealJson } from './seal'
import { serverUrlOf } from './server-url'
import { guardedFetch, SsrfRejectedError, type HostResolver } from './ssrf'
import { McpOauthStore } from './store'
import { buildAuthorizationUrl, refreshAuthorization } from './token'
import {
  needsSignIn,
  PENDING_TTL_MS,
  REFRESH_PASSES,
  REFRESH_POLL_MS,
  REJECTING_STATUSES,
  sleep,
} from './gateway-timing'
import {
  sealedGrantSchema,
  type McpOauthBegin,
  type McpOauthBeginArgs,
  type McpOauthGateway,
  type McpOauthGrant,
  type McpOauthServerRef,
  type McpServerGrantRow,
  type OAuthFetch,
  type SealedGrant,
  type SealedPending,
} from './types'

export type McpOauthGatewayArgs = {
  db: Db
  cipher: SecretCipher
  publicUrl: string
  fetch?: OAuthFetch | undefined
  now?: (() => number) | undefined
  allowLocalTargets?: boolean | undefined
  resolveHost?: HostResolver | undefined
  returns: Pick<BrowserReturnService, 'begin'>
}

export class McpOauthService implements McpOauthGateway {
  private readonly store: McpOauthStore
  private readonly now: () => number
  private readonly fetcher: OAuthFetch
  private readonly redirectUri: string

  constructor(private readonly args: McpOauthGatewayArgs) {
    this.store = new McpOauthStore(args.db)
    this.now = args.now ?? Date.now
    this.fetcher = args.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.redirectUri = `${new URL(args.publicUrl).origin}/mcp-oauth/callback`
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
      const authorizationUrl = buildAuthorizationUrl({
        authorizationEndpoint: found.authorizationEndpoint,
        clientId: clientInfo.clientId,
        redirectUri: this.redirectUri,
        pkce,
        ...(found.scope === undefined ? {} : { scope: found.scope }),
        ...(found.resource === undefined ? {} : { resource: found.resource }),
      })
      const pending: SealedPending = {
        codeVerifier: pkce.verifier,
        clientInfo,
        tokenEndpoint: found.tokenEndpoint,
        redirectUri: this.redirectUri,
        returnTarget: args.returnTarget,
        authorizationUrl,
        ...(found.authMethods === undefined ? {} : { authMethods: found.authMethods }),
        ...(found.resource === undefined ? {} : { resource: found.resource }),
      }
      const returned = await this.args.returns.begin({
        flow: 'mcp',
        state: pkce.state,
        userId: args.userId,
        providerUrl: authorizationUrl,
        callbackPath: MCP_OAUTH_CALLBACK_PATH,
        webPath: returnPathOf(args.returnTarget.screen),
        ttlMs: PENDING_TTL_MS,
      })
      await this.store.insertPending({
        id: pkce.state,
        userId: args.userId,
        serverUrl,
        sealed: sealJson({ cipher: this.args.cipher, value: pending }),
        returnTo: returnPathOf(args.returnTarget.screen),
        surface: args.returnTarget.surface,
        expiresAt: returned.expiresAt,
        mcpServerId: resolved.row.id,
      })
      return {
        ok: true,
        url: authorizationUrl,
        startUrl: returned.startUrl,
        expiresAt: returned.expiresAt.toISOString(),
      }
    } catch (error) {
      const reason =
        error instanceof SsrfRejectedError || error instanceof OAuthError
          ? error.message
          : `could not reach the server: ${String(error)}`.slice(0, 200)
      return { ok: false, reason }
    }
  }

  async refresh(args: McpOauthServerRef): Promise<McpOauthGrant> {
    const resolved = await this.rowFor(args)
    if (!resolved.ok) return { ok: false, reason: resolved.reason, signIn: true }
    for (let pass = 0; pass < REFRESH_PASSES; pass += 1) {
      const row = pass === 0 ? resolved.row : await this.store.find({ id: resolved.row.id })
      if (row === null) return needsSignIn()
      const grant = this.activeGrant({ row, serverUrl: this.urlOf(row) })
      if (grant === null) return needsSignIn()
      if (freshTokensOf({ tokens: grant.tokens, now: this.now() })) return grantedOf(grant.tokens)
      if (attemptLiveOf({ row, now: this.now() })) {
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
    const row = await this.cloudRow(args)
    return row === null ? { ok: false, reason: 'mcp server not found' } : { ok: true, row }
  }

  private async cloudRow(args: McpOauthServerRef): Promise<McpServerGrantRow | null> {
    const name = args.name
    if (args.projectId !== undefined) {
      const project = await this.store.findByName({
        projectId: args.projectId,
        source: 'cloud',
        name,
      })
      if (project !== null) return project
    }
    if (args.groupId !== undefined) {
      const group = await this.store.findByName({ groupId: args.groupId, source: 'cloud', name })
      if (group !== null) return group
    }
    return await this.store.findByName({ userId: args.userId, source: 'cloud', name })
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
      !sameServerUrl(row.oauthServerUrl, args.serverUrl)
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
      return stored ? grantedOf(tokens) : undefined
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
