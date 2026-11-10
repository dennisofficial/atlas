import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { McpServerReader } from '../../config/mcp-servers'
import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthCallbackOf } from '../callback'
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

const pendingSealed = (): string =>
  cipher.encrypt(
    JSON.stringify({
      codeVerifier: 'verifier-1',
      clientInfo: { clientId: 'client-1' },
      tokenEndpoint: TOKEN_ENDPOINT,
      redirectUri: REDIRECT_URI,
      authMethods: ['none'],
    }),
  )

const seedPending = async (args: {
  db: Db
  id: string
  mcpServerId: string
  userId?: string
  serverUrl?: string
  expiresAt?: Date
}): Promise<void> => {
  await args.db.orm.public.McpOauthPending.create({
    id: args.id,
    userId: args.userId ?? 'user-1',
    serverUrl: args.serverUrl ?? SERVER_URL,
    sealed: pendingSealed(),
    returnTo: '/settings/integrations',
    returnSurface: 'web',
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
  const response = await handlerOver(args.db)(new Request(`${CALLBACK}?${args.query}`))
  if (response === null) return null
  const location = response.headers.get('location') ?? ''
  return { status: response.status, params: new URL(location).searchParams }
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
