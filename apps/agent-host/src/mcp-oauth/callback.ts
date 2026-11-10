import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '../config/secret-cipher'
import { callbackAnswerOf, DEFAULT_RETURN_TARGET, type CallbackAnswer } from './redirect'
import { sealJson, unsealJson } from './seal'
import { serverUrlOf } from './server-url'
import { guardedFetch, type HostResolver } from './ssrf'
import { McpOauthStore } from './store'
import { exchangeAuthorizationCode } from './token'
import {
  sealedPendingSchema,
  type McpReturnTarget,
  type McpServerGrantRow,
  type OAuthFetch,
  type PendingRow,
  type SealedGrant,
} from './types'

export const MCP_OAUTH_CALLBACK_PATH = '/mcp-oauth/callback'

export type McpOauthCallbackArgs = {
  db: Db
  cipher: SecretCipher
  webOrigin: string
  fetch?: OAuthFetch | undefined
  now?: (() => number) | undefined
  allowLocalTargets?: boolean | undefined
  resolveHost?: HostResolver | undefined
}

const respond = (answer: CallbackAnswer): Response =>
  answer.kind === 'redirect'
    ? new Response(null, { status: 302, headers: { location: answer.location } })
    : new Response(answer.html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })

const ownsRow = async (args: {
  store: McpOauthStore
  row: McpServerGrantRow
  userId: string
}): Promise<boolean> => {
  if (args.row.userId !== null) return args.row.userId === args.userId
  if (args.row.projectId === null) return false
  return (await args.store.projectOwner({ projectId: args.row.projectId })) === args.userId
}

export const mcpOauthCallbackOf = (args: McpOauthCallbackArgs) => {
  const store = new McpOauthStore(args.db)
  const now = args.now ?? Date.now
  const fetcher: OAuthFetch = args.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const fetch = guardedFetch({
    fetch: fetcher,
    allowLocalTargets: args.allowLocalTargets ?? false,
    resolveHost: args.resolveHost,
  })

  const targetOf = (pending: PendingRow | null): McpReturnTarget => {
    if (pending === null) return DEFAULT_RETURN_TARGET
    try {
      return unsealJson({
        cipher: args.cipher,
        sealed: pending.sealed,
        schema: sealedPendingSchema,
      }).returnTarget
    } catch {
      return { surface: pending.surface, screen: DEFAULT_RETURN_TARGET.screen }
    }
  }

  const failedOf = (pending: PendingRow | null) => (reason: string, serverUrl?: string) =>
    respond(
      callbackAnswerOf({
        webOrigin: args.webOrigin,
        target: targetOf(pending),
        serverUrl: serverUrl ?? pending?.serverUrl,
        reason,
      }),
    )

  const exchange = async (pending: PendingRow, code: string): Promise<Response> => {
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
    if (row === null) return failedOf(pending)('server_changed')
    const written = await store.writeGrant({
      id: row.id,
      generation: row.oauthGeneration,
      serverUrl: pending.serverUrl,
      sealed: sealJson({ cipher: args.cipher, value: grant }),
    })
    return written
      ? respond(
          callbackAnswerOf({
            webOrigin: args.webOrigin,
            target: sealed.returnTarget,
            serverUrl: pending.serverUrl,
          }),
        )
      : failedOf(pending)('server_changed')
  }

  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url)
    if (url.pathname !== MCP_OAUTH_CALLBACK_PATH || request.method !== 'GET') return null
    const param = (name: string): string | undefined => url.searchParams.get(name) ?? undefined
    const state = param('state')
    const pending =
      state === undefined || state === '' ? null : await store.takePending({ id: state })
    const failed = failedOf(pending)
    if (pending === null) return failed('unknown_state')
    if (pending.mcpServerId === null) return failed('unknown_state')
    const row = await store.find({ id: pending.mcpServerId })
    if (row === null) return failed('server_changed')
    if (!(await ownsRow({ store, row, userId: pending.userId }))) return failed('session_mismatch')
    if (pending.expiresAt.getTime() < now()) return failed('expired')
    const error = param('error')
    if (error !== undefined) return failed(param('error_description') ?? error)
    const code = param('code')
    if (code === undefined || code === '') return failed('missing_code')
    let serverUrl: string | undefined
    try {
      serverUrl = serverUrlOf({ cipher: args.cipher, row })
    } catch {
      serverUrl = undefined
    }
    if (serverUrl !== pending.serverUrl) return failed('server_changed')
    try {
      return await exchange(pending, code)
    } catch {
      return failed('exchange_failed')
    }
  }
}
