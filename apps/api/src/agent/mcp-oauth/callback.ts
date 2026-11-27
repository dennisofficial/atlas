import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { callbackAnswerOf, DEFAULT_RETURN_TARGET, type CallbackAnswer } from './redirect'
import { sameServerUrl, sealJson, unsealJson } from './seal'
import { serverUrlOf } from './server-url'
import { guardedFetch, type HostResolver } from './ssrf'
import { McpOauthStore } from './store'
import { exchangeAuthorizationCode } from './token'
import {
  EMcpSignInSurface,
  returnSurfaceOf,
  signInSurfaceOf,
  type SignInSurfaceCookie,
} from '@dltech/atlas-plugin-mcp/core'

import { providerErrorOf } from './provider-error'
import { surfaceCookieIn } from './sign-in-cookie'
import {
  sealedPendingSchema,
  type McpReturnScreen,
  type McpReturnTarget,
  type McpServerGrantRow,
  type OAuthFetch,
  type PendingRow,
  type SealedGrant,
} from './types'

export { MCP_OAUTH_CALLBACK_PATH } from './callback-path'

export type QueryParams = { get(name: string): string | null | undefined }

export type CallbackRequest = { query: QueryParams; cookie?: string | undefined }

export type CallbackHandler = (request: CallbackRequest) => Promise<CallbackAnswer>

export type McpOauthCallbackArgs = {
  db: Db
  cipher: SecretCipher
  webOrigin: string
  fetch?: OAuthFetch | undefined
  now?: (() => number) | undefined
  allowLocalTargets?: boolean | undefined
  resolveHost?: HostResolver | undefined
}

const ownsRow = async (args: {
  store: McpOauthStore
  row: McpServerGrantRow
  userId: string
}): Promise<boolean> => await args.store.ownsRow({ row: args.row, userId: args.userId })

export const mcpOauthCallbackOf = (args: McpOauthCallbackArgs) => {
  const store = new McpOauthStore(args.db)
  const now = args.now ?? Date.now
  const fetcher: OAuthFetch = args.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const fetch = guardedFetch({
    fetch: fetcher,
    allowLocalTargets: args.allowLocalTargets ?? false,
    resolveHost: args.resolveHost,
  })

  const screenOf = (pending: PendingRow): McpReturnScreen => {
    try {
      return unsealJson({
        cipher: args.cipher,
        sealed: pending.sealed,
        schema: sealedPendingSchema,
      }).returnTarget.screen
    } catch {
      return DEFAULT_RETURN_TARGET.screen
    }
  }

  const targetOf = (
    pending: PendingRow | null,
    cookie: SignInSurfaceCookie | undefined,
  ): McpReturnTarget => {
    if (pending === null) return DEFAULT_RETURN_TARGET
    const recorded = signInSurfaceOf(pending.surface) ?? EMcpSignInSurface.Web
    return {
      surface: returnSurfaceOf({ state: pending.id, cookie, recorded }),
      screen: screenOf(pending),
    }
  }

  const failedOf =
    (pending: PendingRow | null, cookie: SignInSurfaceCookie | undefined) =>
    (reason: string, serverUrl?: string): CallbackAnswer =>
      callbackAnswerOf({
        webOrigin: args.webOrigin,
        target: targetOf(pending, cookie),
        serverUrl: serverUrl ?? pending?.serverUrl,
        reason,
      })

  const exchange = async (
    pending: PendingRow,
    code: string,
    target: McpReturnTarget,
    refuse: (reason: string) => Promise<CallbackAnswer>,
  ): Promise<CallbackAnswer> => {
    const sealed = unsealJson({
      cipher: args.cipher,
      sealed: pending.sealed,
      schema: sealedPendingSchema,
    })
    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: sealed.tokenEndpoint,
      code,
      codeVerifier: sealed.codeVerifier,
      redirectUri: sealed.redirectUri,
      client: sealed.clientInfo,
      ...(sealed.authMethods === undefined ? {} : { authMethods: sealed.authMethods }),
      ...(sealed.resource === undefined ? {} : { resource: sealed.resource }),
      nowMs: now(),
      fetch,
    })
    const grant: SealedGrant = {
      clientInfo: sealed.clientInfo,
      tokens,
      tokenEndpoint: sealed.tokenEndpoint,
      redirectUri: sealed.redirectUri,
      ...(sealed.authMethods === undefined ? {} : { authMethods: sealed.authMethods }),
      ...(sealed.resource === undefined ? {} : { resource: sealed.resource }),
    }
    const row = await store.find({ id: pending.mcpServerId ?? '' })
    if (row === null) return await refuse('server_changed')
    const written = await store.writeGrant({
      id: row.id,
      generation: row.oauthGeneration,
      serverUrl: pending.serverUrl,
      sealed: sealJson({ cipher: args.cipher, value: grant }),
    })
    return written
      ? callbackAnswerOf({
          webOrigin: args.webOrigin,
          target,
          serverUrl: pending.serverUrl,
        })
      : await refuse('server_changed')
  }

  return async (request: CallbackRequest): Promise<CallbackAnswer> => {
    const param = (name: string): string | undefined => request.query.get(name) ?? undefined
    const cookie = surfaceCookieIn({ cipher: args.cipher, header: request.cookie })
    const state = param('state')
    const claim =
      state === undefined || state === '' ? null : await store.claimPending({ id: state })
    if (claim === null || claim.kind === 'missing') return failedOf(null, cookie)('unknown_state')
    const pending = claim.pending
    const target = targetOf(pending, cookie)
    const refused = async (reason: string, serverUrl?: string): Promise<CallbackAnswer> => {
      await store.deletePending({ id: pending.id })
      return failedOf(pending, cookie)(reason, serverUrl)
    }
    if (pending.mcpServerId === null) return await refused('unknown_state')
    const row = await store.find({ id: pending.mcpServerId })
    if (row === null) return await refused('server_changed')
    if (!(await ownsRow({ store, row, userId: pending.userId })))
      return await refused('session_mismatch')
    if (pending.expiresAt.getTime() < now()) return await refused('expired')
    if (claim.kind === 'completed') {
      const active =
        row.oauthStatus === 'active' && sameServerUrl(row.oauthServerUrl, pending.serverUrl)
      return active
        ? callbackAnswerOf({
            webOrigin: args.webOrigin,
            target,
            serverUrl: pending.serverUrl,
          })
        : await refused('server_changed')
    }
    const error = param('error')
    if (error !== undefined)
      return await refused(
        providerErrorOf({
          error,
          description: param('error_description'),
          issuer: param('iss') ?? pending.serverUrl,
        }),
      )
    const code = param('code')
    if (code === undefined || code === '') return await refused('missing_code')
    let serverUrl: string | undefined
    try {
      serverUrl = serverUrlOf({ cipher: args.cipher, row })
    } catch {
      serverUrl = undefined
    }
    if (!sameServerUrl(serverUrl, pending.serverUrl)) return await refused('server_changed')
    try {
      return await exchange(pending, code, target, refused)
    } catch {
      return await refused('exchange_failed')
    }
  }
}
