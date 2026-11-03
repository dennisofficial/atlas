import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  generatePkce,
  OAuthError,
} from '@dltech/atlas-harness/mcp-oauth'
import {
  EMcpOauthBeginOutcome,
  EMcpServerSource,
  type McpOauthBeginResult,
  type McpOauthServer,
} from '@dltech/atlas-wire'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { discoverOauthEndpoints } from './mcp-oauth-discovery'
import { oauthClientFor } from './mcp-oauth-client-reuse'
import { callbackRedirectOf, DEFAULT_RETURN_TO } from './mcp-oauth-redirect'
import { sealJson, unsealJson } from './mcp-oauth-seal'
import { serverUrlOf, toWireMcpOauthServer } from './mcp-oauth-server-view'
import { assertPublicHost, guardedFetch, SsrfRejectedError } from './mcp-oauth-ssrf'
import { McpOauthClock, McpOauthConfig, McpOauthFetcher, McpOauthStore } from './mcp-oauth.types'
import { sealedPendingSchema } from './mcp-oauth.types'
import type { SealedGrant, SealedPending, ServerGrantRow } from './mcp-oauth.types'

const PENDING_TTL_MS = 10 * 60_000
const PROJECT_NOT_FOUND_MESSAGE = 'project not found'
const SERVER_NOT_FOUND = 'mcp server not found'

@Injectable()
export class McpOauthService {
  constructor(
    private readonly store: McpOauthStore,
    private readonly cipher: SecretCipherService,
    private readonly clock: McpOauthClock,
    private readonly fetcher: McpOauthFetcher,
    private readonly config: McpOauthConfig,
  ) {}

  async servers(args: {
    userId: string
    projectId?: string | undefined
  }): Promise<McpOauthServer[]> {
    const scope =
      args.projectId === undefined
        ? { userId: args.userId }
        : {
            projectId: await this.ownedProject({
              userId: args.userId,
              projectId: args.projectId,
            }),
          }
    const rows = await this.store.listServers(scope)
    return rows.map((row) => toWireMcpOauthServer({ cipher: this.cipher, row }))
  }

  async begin(args: {
    userId: string
    serverId: string
    returnTo?: string | undefined
  }): Promise<McpOauthBeginResult> {
    const row = await this.ownedServer({
      userId: args.userId,
      serverId: args.serverId,
    })
    const serverUrl = this.serverUrlOf(row)
    if (serverUrl === undefined) {
      return this.unsupported(
        'only an http server without its own Authorization header can sign in',
      )
    }
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
      const clientInfo = await oauthClientFor({
        row,
        cipher: this.cipher,
        nowMs: this.clock.now(),
        redirectUri: this.config.redirectUri,
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
        mcpServerId: row.id,
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
      return this.redirect({
        returnTo: DEFAULT_RETURN_TO,
        reason: 'unknown_state',
      })
    }
    const { returnTo, serverUrl } = pending
    const failed = (reason: string) => this.redirect({ returnTo, serverUrl, reason })
    if (pending.mcpServerId === null) return failed('unknown_state')
    if (args.malformed === true) return failed('invalid_request')
    if (args.sessionUserId !== pending.userId) return failed('session_mismatch')
    if (pending.expiresAt.getTime() < this.clock.now()) return failed('expired')
    if (args.error !== undefined) return failed(args.errorDescription ?? args.error)
    if (args.code === undefined || args.code === '') return failed('missing_code')

    const row = await this.store.findServer({ id: pending.mcpServerId })
    if (row === null) return failed('server_changed')
    if (this.serverUrlOf(row) !== pending.serverUrl) return failed('server_changed')

    try {
      const sealed = unsealJson({
        cipher: this.cipher,
        sealed: pending.sealed,
        schema: sealedPendingSchema,
      })
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: sealed.tokenEndpoint,
        code: args.code,
        pkce: {
          verifier: sealed.codeVerifier,
          challenge: '',
          state: pending.id,
        },
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
      await this.store.writeGrant({
        id: row.id,
        serverUrl,
        sealed: sealJson({ cipher: this.cipher, value: grant }),
      })
      return this.redirect({ returnTo, serverUrl })
    } catch {
      return failed('exchange_failed')
    }
  }

  async disconnect(args: { userId: string; serverId: string }): Promise<void> {
    const row = await this.ownedServer(args)
    await this.store.clearGrant({ id: row.id })
  }

  async forget(args: { userId: string; serverId: string }): Promise<void> {
    const row = await this.ownedServer(args)
    if (row.source !== EMcpServerSource.Repo) {
      throw new BadRequestException('remove cloud servers from the MCP list')
    }
    await this.store.deleteRepoServer({ id: row.id })
  }

  private async ownedServer(args: { userId: string; serverId: string }): Promise<ServerGrantRow> {
    const row = await this.store.findServer({ id: args.serverId })
    if (row === null) throw new NotFoundException(SERVER_NOT_FOUND)
    if (row.userId === args.userId) return row
    if (
      row.projectId !== null &&
      (await this.store.projectOwner({ projectId: row.projectId })) === args.userId
    ) {
      return row
    }
    throw new NotFoundException(SERVER_NOT_FOUND)
  }

  private async ownedProject(args: { userId: string; projectId: string }): Promise<string> {
    const owner = await this.store.projectOwner({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException(PROJECT_NOT_FOUND_MESSAGE)
    return args.projectId
  }

  private serverUrlOf(row: ServerGrantRow): string | undefined {
    return serverUrlOf({ cipher: this.cipher, row })
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

  private redirect(args: {
    returnTo: string
    serverUrl?: string | undefined
    reason?: string | undefined
  }): string {
    return callbackRedirectOf({ webOrigin: this.config.webOrigin, ...args })
  }
}
