import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { callOf, failingReason, seedPending, tokenFetch } from './callback.fixture'
import { TOKEN_ENDPOINT, json, restoreFetch, seedCloudServer, stubFetch } from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

const REFUSED_AT = new Date('2026-11-20T12:00:00.000Z')

const refusalOf = async (db: Db) => await db.orm.public.McpServer.first({ id: 'srv-posthog' })

describe('a sign-in the provider refused', () => {
  it('reports a moved server url before the provider error and writes no refusal', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({
      db,
      id: 'state-moved-denied',
      mcpServerId: 'srv-posthog',
      serverUrl: 'https://elsewhere.example.com/mcp',
    })

    expect(await failingReason({ db, query: 'state=state-moved-denied&error=access_denied' })).toBe(
      'server_changed',
    )
    expect((await refusalOf(db))?.oauthRefusal).toBeNull()
  })

  it('remembers a provider refusal on the server it was started for', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-denied', mcpServerId: 'srv-posthog' })

    const reason = await failingReason({ db, query: 'state=state-denied&error=access_denied' })

    const row = await refusalOf(db)
    expect(reason).toBe('mcp.example.com answered: access_denied')
    expect(row?.oauthRefusal).toBe(reason)
    expect(row?.oauthRefusedAt).toBeInstanceOf(Date)
    expect(row?.oauthStatus).toBeNull()
  })

  it('remembers a failed exchange on the server it was started for', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-bad-code', mcpServerId: 'srv-posthog' })
    stubFetch((call) =>
      call.url === TOKEN_ENDPOINT
        ? json({ error: 'invalid_grant' }, { status: 400 })
        : new Response('not found', { status: 404 }),
    )

    expect(await failingReason({ db, query: 'state=state-bad-code&code=code-1' })).toBe(
      'exchange_failed',
    )
    const row = await refusalOf(db)
    expect(row?.oauthRefusal).toBe('exchange_failed')
    expect(row?.oauthRefusedAt).toBeInstanceOf(Date)
  })

  it('remembers nothing for a link the server never belonged to', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedCloudServer({ db, name: 'posthog' })
    await seedPending({ db, id: 'state-theirs', mcpServerId: 'srv-posthog', userId: 'user-2' })
    await seedPending({
      db,
      id: 'state-stale',
      mcpServerId: 'srv-posthog',
      expiresAt: new Date(Date.now() - 1_000),
    })

    expect(await failingReason({ db, query: 'state=state-theirs&error=access_denied' })).toBe(
      'session_mismatch',
    )
    expect(await failingReason({ db, query: 'state=state-stale&error=access_denied' })).toBe(
      'expired',
    )

    const row = await refusalOf(db)
    expect(row?.oauthRefusal).toBeNull()
    expect(row?.oauthRefusedAt).toBeNull()
  })

  it('forgets the refusal once a grant is written', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    await db.orm.public.McpServer.where({ id: 'srv-posthog' }).updateAndCount({
      oauthRefusal: 'mcp.example.com answered: access_denied',
      oauthRefusedAt: REFUSED_AT,
    })
    await seedPending({ db, id: 'state-again', mcpServerId: 'srv-posthog' })
    tokenFetch()

    const answer = await callOf({ db, query: 'state=state-again&code=code-1' })

    expect(answer.params.get('atlasReturn')).toBe('connected')
    const row = await refusalOf(db)
    expect(row?.oauthStatus).toBe('active')
    expect(row?.oauthRefusal).toBeNull()
    expect(row?.oauthRefusedAt).toBeNull()
  })
})
