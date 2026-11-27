import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import type { BrowserReturnService } from '../browser-return/service'
import { providerErrorOf } from './provider-error'
import { DEFAULT_RETURN_TO, returnPathOf } from './redirect'
import { sameServerUrl, sealJson, unsealJson } from './seal'
import { serverUrlOf } from './server-url'
import { guardedFetch, type HostResolver } from './ssrf'
import { McpOauthStore } from './store'
import { exchangeAuthorizationCode } from './token'
import {
  sealedPendingSchema,
  type McpReturnScreen,
  type McpServerGrantRow,
  type OAuthFetch,
  type PendingRow,
  type SealedGrant,
} from './types'

export { MCP_OAUTH_CALLBACK_PATH } from './callback-path'

export type QueryParams = { get(name: string): string | null | undefined }

export type CallbackRequest = { query: QueryParams; cookie?: string | undefined }

export type CallbackAnswer =
  | { kind: 'redirect'; location: string; setCookie?: string | undefined }
  | { kind: 'page'; html: string; setCookie?: string | undefined }

export type CallbackHandler = (request: CallbackRequest) => Promise<CallbackAnswer>

export type McpOauthCallbackArgs = {
  db: Db
  cipher: SecretCipher
  returns: Pick<BrowserReturnService, 'answer'>
  fetch?: OAuthFetch | undefined
  now?: (() => number) | undefined
  allowLocalTargets?: boolean | undefined
  resolveHost?: HostResolver | undefined
}

const DEFAULT_SCREEN: McpReturnScreen = { kind: 'settings', scope: 'user' }

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
      return DEFAULT_SCREEN
    }
  }

  const answerOf = async (args2: {
    state: string
    cookieHeader: string | undefined
    outcome: ReturnOutcome
    fallbackWebPath: string
  }): Promise<CallbackAnswer> => {
    const answer = await args.returns.answer({
      state: args2.state,
      cookieHeader: args2.cookieHeader,
      outcome: args2.outcome,
      fallbackWebPath: args2.fallbackWebPath,
    })
    return answer.kind === 'redirect'
      ? { kind: 'redirect', location: answer.location, setCookie: answer.clearCookie }
      : { kind: 'page', html: answer.html, setCookie: answer.clearCookie }
  }

  const exchange = async (args2: {
    pending: PendingRow
    code: string
    connected: () => Promise<CallbackAnswer>
    refuse: (reason: string) => Promise<CallbackAnswer>
  }): Promise<CallbackAnswer> => {
    const { pending } = args2
    const sealed = unsealJson({
      cipher: args.cipher,
      sealed: pending.sealed,
      schema: sealedPendingSchema,
    })
    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: sealed.tokenEndpoint,
      code: args2.code,
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
    if (row === null) return await args2.refuse('server_changed')
    const written = await store.writeGrant({
      id: row.id,
      generation: row.oauthGeneration,
      serverUrl: pending.serverUrl,
      sealed: sealJson({ cipher: args.cipher, value: grant }),
    })
    return written ? await args2.connected() : await args2.refuse('server_changed')
  }

  const answered = async (request: CallbackRequest): Promise<CallbackAnswer> => {
    const param = (name: string): string | undefined => request.query.get(name) ?? undefined
    const state = param('state')
    const claim =
      state === undefined || state === '' ? null : await store.claimPending({ id: state })
    const pending = claim === null || claim.kind === 'missing' ? null : claim.pending
    const fallbackWebPath = pending === null ? DEFAULT_RETURN_TO : returnPathOf(screenOf(pending))
    const answeredOf = async (outcome: ReturnOutcome): Promise<CallbackAnswer> =>
      await answerOf({
        state: state ?? '',
        cookieHeader: request.cookie,
        outcome,
        fallbackWebPath,
      })
    const failedAs = async (reason: string): Promise<CallbackAnswer> =>
      await answeredOf({ result: EReturnResult.Failed, reason })
    if (pending === null || claim === null) return await failedAs('unknown_state')
    const refused = async (reason: string): Promise<CallbackAnswer> => {
      await store.deletePending({ id: pending.id })
      return await failedAs(reason)
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
        ? await answeredOf({ result: EReturnResult.Connected })
        : await refused('server_changed')
    }
    let serverUrl: string | undefined
    try {
      serverUrl = serverUrlOf({ cipher: args.cipher, row })
    } catch {
      serverUrl = undefined
    }
    if (!sameServerUrl(serverUrl, pending.serverUrl)) return await refused('server_changed')
    const refusedByProvider = async (reason: string): Promise<CallbackAnswer> => {
      await store.refuseLatestAttempt({
        id: row.id,
        refusal: { reason, at: new Date(now()) },
        pendingId: pending.id,
      })
      return await refused(reason)
    }
    const error = param('error')
    if (error !== undefined)
      return await refusedByProvider(
        providerErrorOf({
          error,
          description: param('error_description'),
          issuer: param('iss') ?? pending.serverUrl,
        }),
      )
    const code = param('code')
    if (code === undefined || code === '') return await refusedByProvider('missing_code')
    try {
      return await exchange({
        pending,
        code,
        connected: async () => await answeredOf({ result: EReturnResult.Connected }),
        refuse: refused,
      })
    } catch {
      return await refusedByProvider('exchange_failed')
    }
  }

  return answered
}
