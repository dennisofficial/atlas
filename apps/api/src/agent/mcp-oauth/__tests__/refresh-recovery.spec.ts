import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { seedOwner, sealed } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthGatewayOf } from '../gateway'
import { STALE_ATTEMPT_MS } from '../gateway-timing'
import { McpOauthStore } from '../store'
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
const NOW = Date.parse('2026-11-28T12:00:00.000Z')
const OLD_ATTEMPT = { id: 'srv-paper', generation: 0, attemptId: 'old-host' }
const NEW_ATTEMPT = { ...OLD_ATTEMPT, attemptId: 'new-host', startedAt: new Date(NOW) }

afterEach(restoreFetch)

const seedAttempt = async (startedAt: Date | null) => {
  const { db } = testDb()
  await seedOwner(db)
  await seedCloudServer({ db, name: 'paper', scope: { projectId: 'proj-1' } })
  await db.orm.public.McpServer.where({ id: OLD_ATTEMPT.id }).updateAndCount({
    oauthStatus: 'active',
    oauthServerUrl: SERVER_URL,
    oauthSealed: sealed(
      grantOf({
        accessToken: 'at-old',
        refreshToken: 'rt-old',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ),
    oauthRefreshAttempt: OLD_ATTEMPT.attemptId,
    oauthRefreshStartedAt: startedAt,
  })
  return db
}

describe('recovering an abandoned MCP OAuth refresh', () => {
  it('refreshes the grant after the old host left an expired attempt', async () => {
    const db = await seedAttempt(new Date(NOW - STALE_ATTEMPT_MS))
    const { calls } = stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 })
        : new Response('not found', { status: 404 }),
    )
    const gateway = mcpOauthGatewayOf({
      db,
      cipher,
      publicUrl: 'https://api.byatlas.io',
      allowLocalTargets: true,
      now: () => NOW,
      returns: { begin: async () => ({ startUrl: '', expiresAt: new Date(NOW) }) },
    })

    expect(
      await gateway.refresh({
        userId: 'user-1',
        projectId: 'proj-1',
        source: 'cloud',
        name: 'paper',
        url: SERVER_URL,
      }),
    ).toEqual({
      ok: true,
      accessToken: 'at-new',
      expiresAt: new Date(NOW + 3_600_000).toISOString(),
    })
    expect(calls).toHaveLength(1)
    const row = await db.orm.public.McpServer.first({ id: OLD_ATTEMPT.id })
    expect(row?.oauthRefreshAttempt).toBeNull()
    expect(row?.oauthGeneration).toBe(1)
  })

  it('does not steal an attempt still inside its live window', async () => {
    const db = await seedAttempt(new Date(NOW - STALE_ATTEMPT_MS + 1))
    const store = new McpOauthStore(db)

    expect(await store.claim(NEW_ATTEMPT)).toBe(false)
    const row = await store.find({ id: OLD_ATTEMPT.id })
    expect(row?.oauthRefreshAttempt).toBe(OLD_ATTEMPT.attemptId)
  })

  it('can reclaim an attempt whose start time is absent', async () => {
    const db = await seedAttempt(null)
    const store = new McpOauthStore(db)

    expect(await store.claim(NEW_ATTEMPT)).toBe(true)
  })

  it('lets only one new holder reclaim the stale attempt', async () => {
    const db = await seedAttempt(new Date(NOW - STALE_ATTEMPT_MS))
    const store = new McpOauthStore(db)
    const claimed = await Promise.all([
      store.claim(NEW_ATTEMPT),
      store.claim({ ...NEW_ATTEMPT, attemptId: 'other-host' }),
    ])

    expect(claimed.filter(Boolean)).toHaveLength(1)
  })

  it('fences late writes from the abandoned attempt', async () => {
    const db = await seedAttempt(new Date(NOW - STALE_ATTEMPT_MS))
    const store = new McpOauthStore(db)
    expect(await store.claim(NEW_ATTEMPT)).toBe(true)

    expect(await store.complete({ ...OLD_ATTEMPT, sealed: 'old-grant' })).toBe(false)
    expect(await store.release(OLD_ATTEMPT)).toBe(false)
    expect(await store.reject(OLD_ATTEMPT)).toBe(false)
    expect(await store.complete({ ...NEW_ATTEMPT, sealed: 'new-grant' })).toBe(true)
    const row = await store.find({ id: OLD_ATTEMPT.id })
    expect(row?.oauthSealed).toBe('new-grant')
    expect(row?.oauthGeneration).toBe(1)
  })
})
