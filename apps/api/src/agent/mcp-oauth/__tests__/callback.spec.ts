import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { McpServerReader } from '../../config/mcp-servers'
import { seedGroup, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { answerOf, callOf, failingReason, seedPending, tokenFetch } from './callback.fixture'
import {
  SERVER_URL,
  TOKEN_ENDPOINT,
  cipher,
  json,
  restoreFetch,
  seedCloudServer,
  stubFetch,
} from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

describe('the mcp oauth callback', () => {
  it('seals nothing and reports an unknown state', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await answerOf({ db, query: 'state=nope&code=c' })

    const location = new URL(answer.location)
    expect(location.pathname).toBe('/settings/integrations')
    expect(location.searchParams.get('atlasReturn')).toBe('failed')
    expect(location.searchParams.get('atlasReason')).toBe('unknown_state')
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
      'mcp.example.com answered: access_denied',
    )
  })

  it('exchanges the code, seals the grant and reads back as a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-good', mcpServerId: 'srv-posthog' })
    const { calls } = tokenFetch()

    const answer = await callOf({ db, query: 'state=state-good&code=code-1' })

    expect(answer.status).toBe(302)
    expect(answer.params.get('atlasReturn')).toBe('connected')
    expect(answer.params.get('atlasState')).toBe('state-good')
    expect(calls.find((call) => call.url === TOKEN_ENDPOINT)?.body).toContain(
      'code_verifier=verifier-1',
    )
    expect(await db.orm.public.McpOauthPending.all()).toMatchObject([
      { id: 'state-good', completedAt: expect.any(Date) },
    ])
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

    const location = new URL(answer.location)
    expect(location.pathname).toBe('/sessions/ses_1')
    expect(location.searchParams.get('atlasReturn')).toBe('failed')
    expect(location.searchParams.get('atlasReason')).toBe('expired')
  })

  it('answers a repeated callback with the same success and re-exchanges nothing', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-repeat', mcpServerId: 'srv-posthog' })
    const { calls } = tokenFetch()

    const first = await callOf({ db, query: 'state=state-repeat&code=code-1' })
    const second = await callOf({ db, query: 'state=state-repeat&code=code-2' })

    expect(first.params.get('atlasReturn')).toBe('connected')
    expect(second.status).toBe(302)
    expect(second.params.get('atlasReturn')).toBe('connected')
    expect(calls.filter((call) => call.url === TOKEN_ENDPOINT)).toHaveLength(1)
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthGeneration).toBe(1)
  })

  it('still fails a repeated callback whose first attempt exchanged nothing', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-redo', mcpServerId: 'srv-posthog' })
    const { calls } = stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ error: 'invalid_grant' }, { status: 400 })
        : new Response('not found', { status: 404 }),
    )

    expect(await failingReason({ db, query: 'state=state-redo&code=code-1' })).toBe(
      'exchange_failed',
    )
    const again = await callOf({ db, query: 'state=state-redo&code=code-2' })
    expect(again.params.get('atlasReturn')).toBe('failed')
    expect(again.params.get('atlasReason')).toBe('unknown_state')
    expect(calls.filter((call) => call.url === TOKEN_ENDPOINT)).toHaveLength(1)
  })

  it('reports an unknown state on the settings page', async () => {
    const { db } = testDb()
    await seedOwner(db)

    const answer = await answerOf({ db, query: 'state=nowhere&code=c' })

    const location = new URL(answer.location)
    expect(location.pathname).toBe('/settings/integrations')
    expect(location.searchParams.get('atlasReason')).toBe('unknown_state')
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

  it('seals a grant on a group server and returns to the group MCP page', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await seedCloudServer({ db, name: 'posthog', scope: { groupId: 'grp-1' } })
    await seedPending({
      db,
      id: 'state-group',
      mcpServerId: 'srv-posthog',
      target: { surface: 'web', screen: { kind: 'settings', scope: 'group', id: 'grp-1' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-group&code=code-1' })

    const location = new URL(answer.location)
    expect(location.pathname).toBe('/groups/grp-1/settings/mcp')
    expect(location.searchParams.get('atlasReturn')).toBe('connected')
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthStatus).toBe('active')
  })

  it('refuses a group row for someone outside the group', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedCloudServer({ db, name: 'posthog', scope: { groupId: 'grp-1' } })
    await seedPending({ db, id: 'state-outsider', mcpServerId: 'srv-posthog', userId: 'user-2' })

    expect(await failingReason({ db, query: 'state=state-outsider&code=c' })).toBe(
      'session_mismatch',
    )
  })
})
