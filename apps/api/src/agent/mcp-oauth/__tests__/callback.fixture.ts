import { EReturnSurface } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import { expect } from 'bun:test'

import { returnCookieOf } from '../../browser-return/cookie'
import { BrowserReturnService } from '../../browser-return/service'
import { MCP_OAUTH_CALLBACK_PATH, mcpOauthCallbackOf, type CallbackHandler } from '../callback'
import { returnPathOf } from '../redirect'
import type { McpReturnTarget } from '../types'
import {
  REDIRECT_URI,
  SERVER_URL,
  TOKEN_ENDPOINT,
  WEB_ORIGIN,
  cipher,
  json,
  stubFetch,
} from './fixtures'

export const CALLBACK = 'https://api.byatlas.io/mcp-oauth/callback'

export const PUBLIC_URL = 'https://api.byatlas.io'

export const SESSION_ON_WEB: McpReturnTarget = {
  surface: 'web',
  screen: { kind: 'session', id: 'ses_1' },
}

export const returnsOver = (db: Db): BrowserReturnService =>
  new BrowserReturnService({ db, cipher, publicUrl: PUBLIC_URL, webOrigin: WEB_ORIGIN })

export const pendingSealed = (target: McpReturnTarget = SESSION_ON_WEB): string =>
  cipher.encrypt(
    JSON.stringify({
      codeVerifier: 'verifier-1',
      clientInfo: { clientId: 'client-1' },
      tokenEndpoint: TOKEN_ENDPOINT,
      redirectUri: REDIRECT_URI,
      authMethods: ['none'],
      returnTarget: target,
    }),
  )

export const seedPending = async (args: {
  db: Db
  id: string
  mcpServerId: string
  userId?: string
  serverUrl?: string
  expiresAt?: Date
  target?: McpReturnTarget
}): Promise<void> => {
  const target = args.target ?? SESSION_ON_WEB
  await args.db.orm.public.McpOauthPending.create({
    id: args.id,
    userId: args.userId ?? 'user-1',
    serverUrl: args.serverUrl ?? SERVER_URL,
    sealed: pendingSealed(target),
    returnTo: returnPathOf(target.screen),
    returnSurface: target.surface,
    expiresAt: args.expiresAt ?? new Date(Date.now() + 60_000),
    mcpServerId: args.mcpServerId,
  })
}

export const cookieOf = (args: { state: string; surface: EReturnSurface; port?: number }): string =>
  returnCookieOf({
    cipher,
    cookie: {
      state: args.state,
      surface: args.surface,
      ...(args.port === undefined ? {} : { port: args.port }),
    },
    path: MCP_OAUTH_CALLBACK_PATH,
  }).split(';')[0] ?? ''

export const callbackOver = (db: Db): CallbackHandler =>
  mcpOauthCallbackOf({
    db,
    cipher,
    returns: returnsOver(db),
    allowLocalTargets: true,
  })

export const answerOf = async (args: {
  db: Db
  query: string
  cookie?: string
}): Promise<{ status: number; location: string; setCookie: string | null; body: string }> => {
  const answer = await callbackOver(args.db)({
    query: new URLSearchParams(args.query),
    ...(args.cookie === undefined ? {} : { cookie: args.cookie }),
  })
  return answer.kind === 'redirect'
    ? {
        status: 302,
        location: answer.location,
        setCookie: answer.setCookie ?? null,
        body: '',
      }
    : { status: 200, location: '', setCookie: answer.setCookie ?? null, body: answer.html }
}

export const callOf = async (args: {
  db: Db
  query: string
  cookie?: string
}): Promise<{ status: number; params: URLSearchParams; setCookie: string | null }> => {
  const answer = await answerOf(args)
  return {
    status: answer.status,
    params: new URL(answer.location).searchParams,
    setCookie: answer.setCookie,
  }
}

export const failingReason = async (args: {
  db: Db
  query: string
  cookie?: string
}): Promise<string | undefined> => {
  const answer = await callOf(args)
  expect(answer.status).toBe(302)
  expect(answer.params.get('atlasReturn')).toBe('failed')
  return answer.params.get('atlasReason') ?? undefined
}

export const tokenFetch = () =>
  stubFetch((call) =>
    call.url === TOKEN_ENDPOINT
      ? json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
      : new Response('not found', { status: 404 }),
  )
