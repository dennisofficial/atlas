import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { McpServerReader } from '../../config/mcp-servers'
import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthCallbackOf } from '../callback'
import { returnPathOf } from '../redirect'
import type { McpReturnTarget } from '../types'
import type { Db } from '@dltech/atlas-db'
import {
  REDIRECT_URI,
  SERVER_URL,
  TOKEN_ENDPOINT,
  WEB_ORIGIN,
  cipher,
  json,
  restoreFetch,
  seedCloudServer,
  stubFetch,
} from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

const CALLBACK = 'https://agent.byatlas.io/mcp-oauth/callback'

const SESSION_ON_WEB: McpReturnTarget = {
  surface: 'web',
  screen: { kind: 'session', id: 'ses_1' },
}

const pendingSealed = (target: McpReturnTarget = SESSION_ON_WEB): string =>
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

const seedPending = async (args: {
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

const handlerOver = (db: Db) =>
  mcpOauthCallbackOf({ db, cipher, webOrigin: WEB_ORIGIN, allowLocalTargets: true })

const callOf = async (args: {
  db: Db
  query: string
}): Promise<{ status: number; params: URLSearchParams } | null> => {
  const answer = await answerOf(args)
  if (answer === null) return null
  return { status: answer.status, params: new URL(answer.location).searchParams }
}

const answerOf = async (args: {
  db: Db
  query: string
}): Promise<{ status: number; location: string; body: string } | null> => {
  const response = await handlerOver(args.db)(new Request(`${CALLBACK}?${args.query}`))
  if (response === null) return null
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    body: await response.text(),
  }
}

const failingReason = async (args: { db: Db; query: string }): Promise<string | undefined> => {
  const answer = await callOf(args)
  expect(answer?.status).toBe(302)
  expect(answer?.params.get('mcpOauth')).toBe('failed')
  return answer?.params.get('mcpReason') ?? undefined
}

const tokenFetch = () =>
  stubFetch((call) =>
    call.url === TOKEN_ENDPOINT
      ? json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
      : new Response('not found', { status: 404 }),
  )

describe('the mcp oauth callback', () => {
  it('leaves every other path to the stream server', async () => {
    const { db } = testDb()
    await seedOwner(db)
    expect(await handlerOver(db)(new Request('https://agent.byatlas.io/healthz'))).toBeNull()
    expect(await handlerOver(db)(new Request('https://agent.byatlas.io/stream'))).toBeNull()
  })

  it('seals nothing and reports an unknown state', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    expect(await failingReason({ db, query: 'state=nope&code=c' })).toBe('unknown_state')
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthSealed).toBeNull()
  })

  it('seals nothing for an expired pending row', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-old',
      mcpServerId: 'srv-posthog',
      expiresAt: new Date(Date.now() - 1_000),
    })

    expect(await failingReason({ db, query: 'state=state-old&code=c' })).toBe('expired')
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthSealed).toBeNull()
  })

  it('seals nothing for a pending row of another user', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-theirs', mcpServerId: 'srv-posthog', userId: 'user-2' })

    expect(await failingReason({ db, query: 'state=state-theirs&code=c' })).toBe('session_mismatch')
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthSealed).toBeNull()
  })

  it('seals nothing when the server url moved since begin', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-moved',
      mcpServerId: 'srv-posthog',
      serverUrl: 'https://elsewhere.example.com/mcp',
    })

    expect(await failingReason({ db, query: 'state=state-moved&code=c' })).toBe('server_changed')
  })

  it('reports the provider error and carries no code', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-denied', mcpServerId: 'srv-posthog' })

    expect(await failingReason({ db, query: 'state=state-denied&error=access_denied' })).toBe(
      'access_denied',
    )
  })

  it('exchanges the code, seals the grant and reads back as a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-good', mcpServerId: 'srv-posthog' })
    const { calls } = tokenFetch()

    const answer = await callOf({ db, query: 'state=state-good&code=code-1' })

    expect(answer?.status).toBe(302)
    expect(answer?.params.get('mcpOauth')).toBe('connected')
    expect(answer?.params.get('mcpServer')).toBe(SERVER_URL)
    expect(calls.find((call) => call.url === TOKEN_ENDPOINT)?.body).toContain(
      'code_verifier=verifier-1',
    )
    expect(await db.orm.public.McpOauthPending.all()).toEqual([])
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthStatus).toBe('active')
    expect(row?.oauthServerUrl).toBe(SERVER_URL)
    expect(row?.oauthGeneration).toBe(1)
    expect(row?.oauthRefreshAttempt).toBeNull()
    const sealed = JSON.parse(cipher.decrypt(row?.oauthSealed ?? '')) as {
      tokens: { accessToken: string; refreshToken: string }
      tokenEndpoint: string
      redirectUri: string
      clientInfo: { clientId: string }
    }
    expect(sealed.tokens.accessToken).toBe('at-1')
    expect(sealed.tokens.refreshToken).toBe('rt-1')

    const cloud = await new McpServerReader({ db, cipher }).read({ sessionId: 's-1' })
    expect(cloud.rows).toEqual([
      {
        source: 'user',
        spec: { name: 'posthog', transport: { kind: 'http', url: SERVER_URL } },
        accessToken: 'at-1',
      },
    ])
  })

  it('returns to the session the sign-in started from', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-session', mcpServerId: 'srv-posthog' })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-session&code=code-1' })

    expect(answer?.status).toBe(302)
    const location = new URL(answer?.location ?? '')
    expect(location.origin).toBe(WEB_ORIGIN)
    expect(location.pathname).toBe('/sessions/ses_1')
    expect(location.searchParams.get('mcpOauth')).toBe('connected')
    expect(location.searchParams.get('mcpServer')).toBe(SERVER_URL)
  })

  it('returns to the project settings page the flow started from', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-project',
      mcpServerId: 'srv-posthog',
      target: { surface: 'web', screen: { kind: 'settings', scope: 'project', id: 'proj_9' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-project&code=code-1' })

    expect(answer?.status).toBe(302)
    const location = new URL(answer?.location ?? '')
    expect(location.origin).toBe(WEB_ORIGIN)
    expect(location.pathname).toBe('/projects/proj_9/settings/mcp')
    expect(location.searchParams.get('mcpOauth')).toBe('connected')
  })

  it('returns to the user settings page the flow started from', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-user',
      mcpServerId: 'srv-posthog',
      target: { surface: 'web', screen: { kind: 'settings', scope: 'user' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-user&code=code-1' })

    expect(new URL(answer?.location ?? '').pathname).toBe('/settings/integrations')
  })

  it('hands a desktop flow back to the app, with the web page as a fallback', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-desktop',
      mcpServerId: 'srv-posthog',
      target: { surface: 'desktop', screen: { kind: 'session', id: 'ses_1' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-desktop&code=code-1' })

    expect(answer?.status).toBe(200)
    expect(answer?.body).toContain('atlas://open/sessions/ses_1?mcpOauth=connected')
    expect(answer?.body).toContain('Continue in the browser')
    expect(answer?.body).toContain(WEB_ORIGIN)
  })

  it('hands an ios session flow to the app', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-ios',
      mcpServerId: 'srv-posthog',
      target: { surface: 'ios', screen: { kind: 'session', id: 'ses_1' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-ios&code=code-1' })

    expect(answer?.status).toBe(200)
    expect(answer?.body).toContain('atlas:///sessions/ses_1?mcpOauth=connected')
  })

  it('keeps an ios settings flow on the web page, which the app has no route for', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-ios-settings',
      mcpServerId: 'srv-posthog',
      target: { surface: 'ios', screen: { kind: 'settings', scope: 'user' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-ios-settings&code=code-1' })

    expect(answer?.status).toBe(302)
    expect(new URL(answer?.location ?? '').pathname).toBe('/settings/integrations')
  })

  it('reports an expired state on the screen the flow started from', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-expired',
      mcpServerId: 'srv-posthog',
      expiresAt: new Date(Date.now() - 1_000),
    })

    const answer = await answerOf({ db, query: 'state=state-expired&code=c' })

    const location = new URL(answer?.location ?? '')
    expect(location.pathname).toBe('/sessions/ses_1')
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
    expect(location.searchParams.get('mcpReason')).toBe('expired')
  })

  it('reports an unknown state on the settings page', async () => {
    const { db } = testDb()
    await seedOwner(db)

    const answer = await answerOf({ db, query: 'state=nowhere&code=c' })

    const location = new URL(answer?.location ?? '')
    expect(location.pathname).toBe('/settings/integrations')
    expect(location.searchParams.get('mcpReason')).toBe('unknown_state')
  })

  it('reports a failed exchange', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-bad', mcpServerId: 'srv-posthog' })
    stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ error: 'invalid_grant' }, { status: 400 })
        : new Response('not found', { status: 404 }),
    )

    expect(await failingReason({ db, query: 'state=state-bad&code=code-1' })).toBe(
      'exchange_failed',
    )
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthSealed).toBeNull()
  })
})
