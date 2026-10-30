import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  generatePkce,
  OAuthError,
  registerClient,
  type ClientInformation,
} from '@dltech/atlas-harness/mcp-oauth'
import {
  EMcpOauthBeginOutcome,
  EMcpOauthCallbackResult,
  EMcpOauthGrantStatus,
  MCP_OAUTH_REASON_PARAM,
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
  type McpOauthBeginResult,
  type McpOauthGrant,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { discoverOauthEndpoints } from './mcp-oauth-discovery'
import { normalizeServerUrl, sealJson, unsealJson } from './mcp-oauth-seal'
import { assertPublicHost, guardedFetch, SsrfRejectedError } from './mcp-oauth-ssrf'
import {
  EGrantRowStatus,
  McpOauthClock,
  McpOauthConfig,
  McpOauthFetcher,
  McpOauthStore,
} from './mcp-oauth.types'
import { sealedGrantSchema, sealedPendingSchema } from './mcp-oauth.types'
import type { SealedGrant, SealedPending } from './mcp-oauth.types'

const PENDING_TTL_MS = 10 * 60_000
const DEFAULT_RETURN_TO = '/settings/integrations'

@Injectable()
export class McpOauthService {
  constructor(
    private readonly store: McpOauthStore,
    private readonly cipher: SecretCipherService,
    private readonly clock: McpOauthClock,
    private readonly fetcher: McpOauthFetcher,
    private readonly config: McpOauthConfig,
  ) {}

  async begin(args: {
    userId: string
    serverUrl: string
    returnTo?: string
  }): Promise<McpOauthBeginResult> {
    const serverUrl = normalizeServerUrl(args.serverUrl)
    const fetch = this.guarded()
    try {
      await assertPublicHost({
        url: serverUrl,
        allowLocalTargets: this.config.allowLocalTargets,
        resolveHost: this.config.resolveHost,
      })
      const found = await discoverOauthEndpoints({
        serverUrl,
        fetch,
        allowLocalTargets: this.config.allowLocalTargets,
      })
      if (!found.supported) return this.unsupported(found.reason)
      const clientInfo = await this.clientFor({
        userId: args.userId,
        serverUrl,
        tokenEndpoint: found.tokenEndpoint,
        ...(found.registrationEndpoint === undefined
          ? {}
          : { registrationEndpoint: found.registrationEndpoint }),
        ...(found.scope === undefined ? {} : { scope: found.scope }),
        fetch,
      })
      if (clientInfo === undefined) {
        return this.unsupported('the server offers no dynamic client registration')
      }
      const pkce = generatePkce()
      const pending: SealedPending = {
        codeVerifier: pkce.verifier,
        clientInfo,
        tokenEndpoint: found.tokenEndpoint,
        redirectUri: this.config.redirectUri,
        ...(found.authMethods === undefined ? {} : { authMethods: found.authMethods }),
        ...(found.resource === undefined ? {} : { resource: found.resource }),
      }
      await this.store.insertPending({
        id: pkce.state,
        userId: args.userId,
        serverUrl,
        sealed: sealJson({ cipher: this.cipher, value: pending }),
        returnTo: args.returnTo ?? DEFAULT_RETURN_TO,
        expiresAt: new Date(this.clock.now() + PENDING_TTL_MS),
      })
      return {
        outcome: EMcpOauthBeginOutcome.Redirect,
        authorizationUrl: buildAuthorizationUrl({
          authorizationEndpoint: found.authorizationEndpoint,
          clientId: clientInfo.clientId,
          redirectUri: this.config.redirectUri,
          pkce,
          ...(found.scope === undefined ? {} : { scope: found.scope }),
          ...(found.resource === undefined ? {} : { resource: found.resource }),
        }),
      }
    } catch (error) {
      if (error instanceof SsrfRejectedError || error instanceof OAuthError) {
        return this.unsupported(error.message)
      }
      return this.unsupported(`could not reach the server: ${String(error)}`.slice(0, 200))
    }
  }

  async complete(args: {
    state?: string | undefined
    code?: string | undefined
    error?: string | undefined
    errorDescription?: string | undefined
    sessionUserId?: string | undefined
    malformed?: boolean | undefined
  }): Promise<string> {
    const pending =
      args.state === undefined || args.state === ''
        ? null
        : await this.store.takePending({ id: args.state })
    if (pending === null) {
      return this.redirect({ returnTo: DEFAULT_RETURN_TO, reason: 'unknown_state' })
    }
    const { returnTo, serverUrl } = pending
    const failed = (reason: string) => this.redirect({ returnTo, serverUrl, reason })
    if (args.malformed === true) return failed('invalid_request')
    if (args.sessionUserId !== pending.userId) return failed('session_mismatch')
    if (pending.expiresAt.getTime() < this.clock.now()) return failed('expired')
    if (args.error !== undefined) return failed(args.errorDescription ?? args.error)
    if (args.code === undefined || args.code === '') return failed('missing_code')

    try {
      const sealed = unsealJson({
        cipher: this.cipher,
        sealed: pending.sealed,
        schema: sealedPendingSchema,
      })
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: sealed.tokenEndpoint,
        code: args.code,
        pkce: { verifier: sealed.codeVerifier, challenge: '', state: pending.id },
        redirectUri: sealed.redirectUri,
        clientId: sealed.clientInfo.clientId,
        ...(sealed.clientInfo.clientSecret === undefined
          ? {}
          : { clientSecret: sealed.clientInfo.clientSecret }),
        ...(sealed.authMethods === undefined
          ? {}
          : { tokenEndpointAuthMethodsSupported: sealed.authMethods }),
        ...(sealed.resource === undefined ? {} : { resource: sealed.resource }),
        clock: { now: () => new Date(this.clock.now()).toISOString() },
        fetch: this.guarded(),
      })
      const grant: SealedGrant = {
        clientInfo: sealed.clientInfo,
        tokens,
        tokenEndpoint: sealed.tokenEndpoint,
        redirectUri: sealed.redirectUri,
        ...(sealed.authMethods === undefined ? {} : { authMethods: sealed.authMethods }),
        ...(sealed.resource === undefined ? {} : { resource: sealed.resource }),
      }
      await this.store.upsertGrant({
        userId: pending.userId,
        serverUrl,
        sealed: sealJson({ cipher: this.cipher, value: grant }),
      })
      return this.redirect({ returnTo, serverUrl })
    } catch {
      return failed('exchange_failed')
    }
  }

  async status(args: { userId: string; serverUrls: string[] }): Promise<McpOauthGrant[]> {
    const normalized = args.serverUrls.map((url) => ({
      url,
      key: normalizeServerUrl(url),
    }))
    const rows = await this.store.findGrants({
      userId: args.userId,
      serverUrls: normalized.map((entry) => entry.key),
    })
    const byUrl = new Map(rows.map((row) => [row.serverUrl, row]))
    return normalized.map(({ url, key }) => {
      const row = byUrl.get(key)
      if (row === undefined) return { serverUrl: url, status: EMcpOauthGrantStatus.None }
      return {
        serverUrl: url,
        status:
          row.status === EGrantRowStatus.Active
            ? EMcpOauthGrantStatus.Connected
            : EMcpOauthGrantStatus.Expired,
        updatedAt: row.updatedAt.toISOString(),
      }
    })
  }

  async disconnect(args: { userId: string; serverUrl: string }): Promise<void> {
    await this.store.deleteGrant({
      userId: args.userId,
      serverUrl: normalizeServerUrl(args.serverUrl),
    })
  }

  private guarded() {
    return guardedFetch({
      fetcher: this.fetcher,
      allowLocalTargets: this.config.allowLocalTargets,
      resolveHost: this.config.resolveHost,
    })
  }

  private unsupported(reason: string): McpOauthBeginResult {
    return { outcome: EMcpOauthBeginOutcome.Unsupported, reason }
  }

  private async clientFor(args: {
    userId: string
    serverUrl: string
    tokenEndpoint: string
    registrationEndpoint?: string
    scope?: string
    fetch: Parameters<typeof registerClient>[0]['fetch']
  }): Promise<ClientInformation | undefined> {
    const existing = await this.store.findGrant({
      userId: args.userId,
      serverUrl: args.serverUrl,
    })
    const reusable =
      existing === null ? undefined : this.reusableClient(existing, args.tokenEndpoint)
    if (reusable !== undefined) return reusable
    if (args.registrationEndpoint === undefined) return undefined
    return registerClient({
      registrationEndpoint: args.registrationEndpoint,
      metadata: {
        redirectUris: [this.config.redirectUri],
        ...(args.scope === undefined ? {} : { scope: args.scope }),
      },
      fetch: args.fetch,
    })
  }

  private reusableClient(row: { sealed: string }, tokenEndpoint: string) {
    let grant: SealedGrant
    try {
      grant = unsealJson({ cipher: this.cipher, sealed: row.sealed, schema: sealedGrantSchema })
    } catch {
      return undefined
    }
    const secretExpiresAt = grant.clientInfo.clientSecretExpiresAt
    const secretExpired =
      secretExpiresAt !== undefined &&
      secretExpiresAt > 0 &&
      secretExpiresAt * 1000 <= this.clock.now()
    const matches =
      grant.redirectUri === this.config.redirectUri && grant.tokenEndpoint === tokenEndpoint
    return matches && !secretExpired ? grant.clientInfo : undefined
  }

  private redirect(args: { returnTo: string; serverUrl?: string; reason?: string }): string {
    const webOrigin = new URL(this.config.webOrigin).origin
    let url = new URL(args.returnTo, webOrigin)
    if (url.origin !== webOrigin) url = new URL(DEFAULT_RETURN_TO, webOrigin)
    url.searchParams.set(
      MCP_OAUTH_RESULT_PARAM,
      args.reason === undefined
        ? EMcpOauthCallbackResult.Connected
        : EMcpOauthCallbackResult.Failed,
    )
    if (args.serverUrl !== undefined) url.searchParams.set(MCP_OAUTH_SERVER_PARAM, args.serverUrl)
    if (args.reason !== undefined) {
      url.searchParams.set(MCP_OAUTH_REASON_PARAM, args.reason.slice(0, 200))
    }
    return url.toString()
  }
}
