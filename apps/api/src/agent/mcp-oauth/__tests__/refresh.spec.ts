import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { seedGroup, seedOwner, sealed } from '../../config/__tests__/config-reader.fixture'
import { settingsVersionsOf } from '../../control/settings-versions'
import { mcpOauthGatewayOf } from '../gateway'
import {
  SERVER_URL,
  TOKEN_ENDPOINT,
  cipher,
  grantOf,
  json,
  restoreFetch,
  seedCloudServer,
  stubFetch,
} from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

const gatewayOver = (db = testDb().db) =>
  mcpOauthGatewayOf({
    db,
    cipher,
    publicUrl: 'https://api.byatlas.io',
    allowLocalTargets: true,
    returns: { begin: async () => ({ startUrl: '', expiresAt: new Date() }) },
  })

const ARGS = {
  userId: 'user-1',
  projectId: 'proj-1',
  source: 'cloud' as const,
  name: 'posthog',
  url: SERVER_URL,
}

const seedGrant = async (args: {
  db: ReturnType<typeof testDb>['db']
  grant: Record<string, unknown>
  scope?: { userId: string } | { groupId: string } | { projectId: string }
}): Promise<void> => {
  await seedCloudServer({
    db: args.db,
    name: 'posthog',
    scope: args.scope ?? { projectId: 'proj-1' },
  })
  await args.db.orm.public.McpServer.where({ id: 'srv-posthog' }).updateAndCount({
    oauthStatus: 'active',
    oauthServerUrl: SERVER_URL,
    oauthSealed: sealed(args.grant),
    oauthUpdatedAt: SIGNED_IN_AT,
  })
}

const SIGNED_IN_AT = new Date('2026-11-01T00:00:00.000Z')

const expiredGrant = () =>
  grantOf({ accessToken: 'at-old', refreshToken: 'rt-old', expiresAt: '2020-01-01T00:00:00.000Z' })

describe('refresh', () => {
  it('returns a fresh token without calling the provider', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({
      db,
      grant: grantOf({ accessToken: 'at-live', expiresAt: '2999-01-01T00:00:00.000Z' }),
    })
    const { calls } = stubFetch(() => new Response('unexpected', { status: 500 }))

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant).toEqual({
      ok: true,
      accessToken: 'at-live',
      expiresAt: '2999-01-01T00:00:00.000Z',
    })
    expect(calls).toEqual([])
  })

  it('needs a sign-in when the row carries no grant', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog', scope: { projectId: 'proj-1' } })

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant.ok).toBe(false)
  })

  it('makes one token call for two concurrent refreshes and rotates the grant', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({ db, grant: expiredGrant() })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls } = stubFetch(async (call) => {
      if (call.url !== TOKEN_ENDPOINT) return new Response('not found', { status: 404 })
      await gate
      return json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 })
    })

    const first = gatewayOver(db).refresh(ARGS)
    const second = gatewayOver(db).refresh(ARGS)
    await new Promise((resolve) => setTimeout(resolve, 100))
    release?.()
    const [a, b] = await Promise.all([first, second])

    expect(calls.filter((call) => call.url === TOKEN_ENDPOINT)).toHaveLength(1)
    if (!a.ok || !b.ok) throw new Error('a refresh failed')
    expect(a.accessToken).toBe('at-new')
    expect(b).toEqual(a)
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthGeneration).toBe(1)
    expect(row?.oauthRefreshAttempt).toBeNull()
    const grant = JSON.parse(cipher.decrypt(row?.oauthSealed ?? '')) as {
      tokens: { accessToken: string; refreshToken: string; expiresAt: string | null }
    }
    expect(grant.tokens).toEqual({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresAt: a.expiresAt,
    })
  })

  it('marks the grant expired when the provider rejects the refresh token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({ db, grant: expiredGrant() })
    stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ error: 'invalid_grant' }, { status: 400 })
        : new Response('not found', { status: 404 }),
    )

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant.ok).toBe(false)
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthStatus).toBe('expired')
    expect(row?.oauthRefreshAttempt).toBeNull()
  })

  it('marks the grant expired when the provider granted no refresh token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({
      db,
      grant: grantOf({ accessToken: 'at-old', expiresAt: '2020-01-01T00:00:00.000Z' }),
    })
    const { calls } = stubFetch(() => new Response('unexpected', { status: 500 }))

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant.ok).toBe(false)
    expect(calls).toEqual([])
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthStatus).toBe('expired')
  })

  it('keeps the sign-in time and the settings version when it rotates the token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({ db, grant: expiredGrant() })
    const before = await settingsVersionsOf({ db, threadId: 't-1' })
    stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 })
        : new Response('not found', { status: 404 }),
    )

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant.ok).toBe(true)
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.oauthGeneration).toBe(1)
    expect(row?.oauthUpdatedAt).toEqual(SIGNED_IN_AT)
    expect(await settingsVersionsOf({ db, threadId: 't-1' })).toEqual(before)
  })

  it('keeps the settings version when the provider is unavailable', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGrant({ db, grant: expiredGrant() })
    const before = await settingsVersionsOf({ db, threadId: 't-1' })
    stubFetch(() => new Response('down', { status: 503 }))

    const grant = await gatewayOver(db).refresh(ARGS)

    expect(grant.ok).toBe(false)
    expect(await settingsVersionsOf({ db, threadId: 't-1' })).toEqual(before)
  })

  it('refreshes a group grant found by its group alone', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await seedGrant({ db, grant: expiredGrant(), scope: { groupId: 'grp-1' } })
    stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 })
        : new Response('not found', { status: 404 }),
    )

    const grant = await gatewayOver(db).refresh({
      userId: 'user-1',
      groupId: 'grp-1',
      source: 'cloud',
      name: 'posthog',
      url: SERVER_URL,
    })

    expect(grant).toEqual({ ok: true, accessToken: 'at-new', expiresAt: expect.any(String) })
    const row = await db.orm.public.McpServer.first({ id: 'srv-posthog' })
    expect(row?.groupId).toBe('grp-1')
  })
})
