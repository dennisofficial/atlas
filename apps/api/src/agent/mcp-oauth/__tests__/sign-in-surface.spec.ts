import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { Db } from '@dltech/atlas-db'
import { afterEach, describe, expect, it } from 'bun:test'

import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthCallbackOf } from '../callback'
import { returnPathOf } from '../redirect'
import { mcpOauthStartOf } from '../start'
import type { McpReturnTarget } from '../types'
import {
  REDIRECT_URI,
  TOKEN_ENDPOINT,
  SERVER_URL,
  WEB_ORIGIN,
  cipher,
  json,
  restoreFetch,
  seedCloudServer,
  stubFetch,
} from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

const AUTHORIZE_URL = 'https://auth.example.com/authorize?state=state-1'

const SESSION: McpReturnTarget = { surface: 'web', screen: { kind: 'session', id: 'ses_1' } }

const seedPending = async (args: {
  db: Db
  id?: string
  expiresAt?: Date
  authorizationUrl?: string | undefined
}): Promise<void> => {
  await args.db.orm.public.McpOauthPending.create({
    id: args.id ?? 'state-1',
    userId: 'user-1',
    serverUrl: SERVER_URL,
    sealed: cipher.encrypt(
      JSON.stringify({
        codeVerifier: 'verifier-1',
        clientInfo: { clientId: 'client-1' },
        tokenEndpoint: TOKEN_ENDPOINT,
        redirectUri: REDIRECT_URI,
        authMethods: ['none'],
        returnTarget: SESSION,
        ...(args.authorizationUrl === undefined ? {} : { authorizationUrl: args.authorizationUrl }),
      }),
    ),
    returnTo: returnPathOf(SESSION.screen),
    returnSurface: SESSION.surface,
    expiresAt: args.expiresAt ?? new Date(Date.now() + 60_000),
    mcpServerId: 'srv-posthog',
  })
}

const seeded = async (args: { authorizationUrl?: string | undefined } = {}) => {
  const { db } = testDb()
  await seedOwner(db)
  await seedCloudServer({ db, name: 'posthog' })
  await seedPending({ db, authorizationUrl: args.authorizationUrl ?? AUTHORIZE_URL })
  return db
}

const cookieHeaderOf = (setCookie: string): string => setCookie.split(';')[0] ?? ''

const tokenFetch = () =>
  stubFetch((call) =>
    call.url === TOKEN_ENDPOINT
      ? json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
      : new Response('not found', { status: 404 }),
  )

const callbackOver = (db: Db) =>
  mcpOauthCallbackOf({ db, cipher, webOrigin: WEB_ORIGIN, allowLocalTargets: true })

describe('the mcp sign-in start link', () => {
  it('records the surface, sets a scoped cookie and sends the browser to the provider', async () => {
    const db = await seeded()

    const answer = await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: 'ios' })

    expect(answer.kind).toBe('redirect')
    if (answer.kind !== 'redirect') return
    expect(answer.location).toBe(AUTHORIZE_URL)
    expect(answer.cookie).toContain('Path=/mcp-oauth/callback')
    expect(answer.cookie).toContain('HttpOnly; Secure; SameSite=Lax')
    const row = await db.orm.public.McpOauthPending.first({ id: 'state-1' })
    expect(row?.returnSurface).toBe('ios')
  })

  it('starts as web when the link names no surface, as an installed TUI opens it', async () => {
    const db = await seeded()

    await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: null })

    const row = await db.orm.public.McpOauthPending.first({ id: 'state-1' })
    expect(row?.returnSurface).toBe('web')
  })

  it('refuses an unknown, expired or used link', async () => {
    const db = await seeded()
    const start = mcpOauthStartOf({ db, cipher, now: () => Date.now() + 120_000 })

    expect((await start({ state: 'state-1', surface: 'ios' })).kind).toBe('gone')
    expect((await mcpOauthStartOf({ db, cipher })({ state: 'nope', surface: 'ios' })).kind).toBe(
      'gone',
    )
  })
})

describe('the mcp sign-in callback surface', () => {
  it('returns to the app that started the sign-in, from its cookie', async () => {
    const db = await seeded()
    const started = await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: 'ios' })
    if (started.kind !== 'redirect') throw new Error('the start link was refused')
    await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: 'desktop' })
    tokenFetch()

    const answer = await callbackOver(db)({
      query: new URLSearchParams('state=state-1&code=code-1'),
      cookie: `other=1; ${cookieHeaderOf(started.cookie)}`,
    })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).toContain('atlas:///sessions/ses_1?mcpOauth=connected')
  })

  it('falls back to the recorded surface when the browser lost the cookie', async () => {
    const db = await seeded()
    await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: 'desktop' })
    tokenFetch()

    const answer = await callbackOver(db)({ query: new URLSearchParams('state=state-1&code=c') })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).toContain('atlas://open/sessions/ses_1?mcpOauth=connected')
  })

  it('ignores a forged cookie', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await callbackOver(db)({
      query: new URLSearchParams('state=state-1&code=c'),
      cookie: 'atlas_mcp_sign_in=ios',
    })

    expect(answer).toMatchObject({ kind: 'redirect' })
  })

  it('names the provider that refused the sign-in', async () => {
    const db = await seeded()
    const started = await mcpOauthStartOf({ db, cipher })({ state: 'state-1', surface: 'ios' })
    if (started.kind !== 'redirect') throw new Error('the start link was refused')

    const answer = await callbackOver(db)({
      query: new URLSearchParams(
        'error=server_error&error_description=An+unexpected+error+occurred&state=state-1&iss=https%3A%2F%2Fmcp-auth.wisprflow.com',
      ),
      cookie: cookieHeaderOf(started.cookie),
    })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).toContain(
      'mcp-auth.wisprflow.com answered: An unexpected error occurred (server_error)',
    )
    expect(answer.html).toContain('atlas:///sessions/ses_1?mcpOauth=failed')
  })
})
