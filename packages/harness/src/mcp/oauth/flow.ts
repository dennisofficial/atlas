import type { ClockPort } from '@dltech/atlas-core'

import { OAuthCallbackServer } from './callback-server'
import {
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  parseWwwAuthenticate,
  selectScope,
  type AuthorizationServerMetadata,
  type OAuthFetch,
  type ProtectedResourceMetadata,
} from './discovery'
import { EOAuthFailure, OAuthError } from './oauth-error'
import { generatePkce } from './pkce'
import { registerClient, type ClientInformation } from './registration'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAuthorization,
  type OAuthTokens,
} from './token'
import { McpOAuthStore } from './token-store'

export type McpOAuthFlowDeps = {
  store: McpOAuthStore
  callbacks: OAuthCallbackServer
  clock: ClockPort
  openBrowser: (url: string) => void
  fetch?: OAuthFetch
}

export enum EMcpAuthOutcome {
  /** Stored tokens were refreshed; no browser needed. */
  Refreshed = 'refreshed',
  /** The full browser flow ran and produced tokens. */
  Authorized = 'authorized',
  /** The server does not support OAuth dynamic registration and has no usable token. */
  NeedsClientRegistration = 'needs-client-registration',
}

export type McpAuthResult =
  | { outcome: EMcpAuthOutcome.Refreshed | EMcpAuthOutcome.Authorized; tokens: OAuthTokens }
  | { outcome: EMcpAuthOutcome.NeedsClientRegistration; reason: string }

const TOKEN_REFRESH_SKEW_MS = 30_000

const isExpired = (args: { tokens: OAuthTokens; clock: ClockPort }): boolean => {
  if (args.tokens.expiresAt === undefined) return false
  return Date.parse(args.tokens.expiresAt) - TOKEN_REFRESH_SKEW_MS <= Date.parse(args.clock.now())
}

export class McpOAuthFlow {
  private readonly fetch: OAuthFetch

  constructor(private readonly deps: McpOAuthFlowDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch
  }

  /**
   * The current bearer token for a server, refreshing when expired. Returns undefined when there
   * is nothing usable — the caller treats that as needs-auth rather than starting a browser flow
   * on its own.
   */
  async currentToken(args: { serverUrl: string }): Promise<string | undefined> {
    const entry = this.deps.store.read(args.serverUrl)
    if (entry?.tokens === undefined) return undefined
    if (!isExpired({ tokens: entry.tokens, clock: this.deps.clock })) return entry.tokens.accessToken

    const refreshed = await this.tryRefresh({ serverUrl: args.serverUrl })
    return refreshed?.accessToken
  }

  /**
   * Sign-in, refresh-first: a stored refresh token is tried before any browser opens. The full
   * discovery → register → browser → exchange flow runs only when refresh cannot produce tokens.
   */
  async signIn(args: { serverUrl: string; wwwAuthenticate?: string }): Promise<McpAuthResult> {
    const refreshed = await this.tryRefresh(args)
    if (refreshed !== undefined) return { outcome: EMcpAuthOutcome.Refreshed, tokens: refreshed }

    const challenge =
      args.wwwAuthenticate === undefined ? {} : parseWwwAuthenticate(args.wwwAuthenticate)
    const prm = await this.protectedResourceMetadata({ serverUrl: args.serverUrl, challenge })
    const asMetadata = await this.authorizationServerMetadata({ serverUrl: args.serverUrl, prm })

    const clientInfo = await this.ensureClient({ serverUrl: args.serverUrl, asMetadata, challenge, prm })
    if (clientInfo.kind === 'failed') {
      return { outcome: EMcpAuthOutcome.NeedsClientRegistration, reason: clientInfo.reason }
    }

    const scope = selectScope({
      ...(challenge.scope === undefined ? {} : { challengeScope: challenge.scope }),
      ...(prm === undefined ? {} : { protectedResourceMetadata: prm }),
    })
    const port = await this.deps.callbacks.ensureRunning()
    const redirectUri = this.deps.callbacks.redirectUri(port)
    const pkce = generatePkce()

    this.deps.store.write(args.serverUrl, {
      ...(clientInfo.value !== undefined ? { clientInfo: clientInfo.value } : {}),
      codeVerifier: pkce.verifier,
    })

    const authorizationUrl = buildAuthorizationUrl({
      authorizationEndpoint: asMetadata.authorization_endpoint,
      clientId: clientInfo.value.clientId,
      redirectUri,
      pkce,
      ...(scope === undefined ? {} : { scope }),
      ...(prm === undefined ? {} : { resource: args.serverUrl }),
    })

    const codePromise = this.deps.callbacks.waitForCallback(pkce.state)
    this.deps.openBrowser(authorizationUrl)
    const code = await codePromise

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: asMetadata.token_endpoint,
      code,
      pkce,
      redirectUri,
      clientId: clientInfo.value.clientId,
      ...(clientInfo.value.clientSecret === undefined
        ? {}
        : { clientSecret: clientInfo.value.clientSecret }),
      ...(asMetadata.token_endpoint_auth_methods_supported === undefined
        ? {}
        : { tokenEndpointAuthMethodsSupported: asMetadata.token_endpoint_auth_methods_supported }),
      clock: this.deps.clock,
      fetch: this.fetch,
    })

    this.deps.store.write(args.serverUrl, { clientInfo: clientInfo.value, tokens })
    return { outcome: EMcpAuthOutcome.Authorized, tokens }
  }

  signOut(args: { serverUrl: string }): void {
    this.deps.store.remove(args.serverUrl)
  }

  private async tryRefresh(args: { serverUrl: string }): Promise<OAuthTokens | undefined> {
    const entry = this.deps.store.read(args.serverUrl)
    const refreshToken = entry?.tokens?.refreshToken
    if (entry?.clientInfo === undefined || refreshToken === undefined) return undefined

    const asMetadata = await this.authorizationServerMetadata({ serverUrl: args.serverUrl }).catch(
      () => undefined,
    )
    if (asMetadata === undefined) return undefined

    try {
      const tokens = await refreshAuthorization({
        tokenEndpoint: asMetadata.token_endpoint,
        refreshToken,
        clientId: entry.clientInfo.clientId,
        ...(entry.clientInfo.clientSecret === undefined
          ? {}
          : { clientSecret: entry.clientInfo.clientSecret }),
        ...(asMetadata.token_endpoint_auth_methods_supported === undefined
          ? {}
          : { tokenEndpointAuthMethodsSupported: asMetadata.token_endpoint_auth_methods_supported }),
        clock: this.deps.clock,
        fetch: this.fetch,
      })
      this.deps.store.write(args.serverUrl, { clientInfo: entry.clientInfo, tokens })
      return tokens
    } catch {
      // A dead refresh token means re-authorize, not fail: drop it and let the caller browse.
      this.deps.store.clearTokens(args.serverUrl)
      return undefined
    }
  }

  private async protectedResourceMetadata(args: {
    serverUrl: string
    challenge: { resourceMetadataUrl?: string }
  }): Promise<ProtectedResourceMetadata | undefined> {
    return discoverProtectedResourceMetadata({
      serverUrl: args.serverUrl,
      ...(args.challenge.resourceMetadataUrl === undefined
        ? {}
        : { resourceMetadataUrl: args.challenge.resourceMetadataUrl }),
      fetch: this.fetch,
    }).catch(() => undefined)
  }

  private async authorizationServerMetadata(args: {
    serverUrl: string
    prm?: ProtectedResourceMetadata | undefined
  }): Promise<AuthorizationServerMetadata> {
    const authServerUrl = args.prm?.authorization_servers[0] ?? new URL('/', args.serverUrl).toString()
    return discoverAuthorizationServerMetadata({ authServerUrl, fetch: this.fetch })
  }

  private async ensureClient(args: {
    serverUrl: string
    asMetadata: AuthorizationServerMetadata
    challenge: { scope?: string }
    prm: ProtectedResourceMetadata | undefined
  }): Promise<{ kind: 'ok'; value: ClientInformation } | { kind: 'failed'; reason: string }> {
    const stored = this.deps.store.read(args.serverUrl)?.clientInfo
    if (stored !== undefined) return { kind: 'ok', value: stored }

    if (args.asMetadata.registration_endpoint === undefined) {
      return {
        kind: 'failed',
        reason: 'the authorization server does not support dynamic client registration',
      }
    }

    const scope = selectScope({
      ...(args.challenge.scope === undefined ? {} : { challengeScope: args.challenge.scope }),
      ...(args.prm === undefined ? {} : { protectedResourceMetadata: args.prm }),
    })
    try {
      const value = await registerClient({
        registrationEndpoint: args.asMetadata.registration_endpoint,
        metadata: { redirectUris: [this.deps.callbacks.redirectUri(await this.deps.callbacks.ensureRunning())], ...(scope === undefined ? {} : { scope }) },
        fetch: this.fetch,
      })
      this.deps.store.write(args.serverUrl, { clientInfo: value })
      return { kind: 'ok', value }
    } catch (error) {
      if (error instanceof OAuthError && error.failure === EOAuthFailure.RegistrationFailed) {
        return { kind: 'failed', reason: error.message }
      }
      throw error
    }
  }
}
