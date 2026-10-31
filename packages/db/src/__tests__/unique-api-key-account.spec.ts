import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'

const MIGRATION = '20261031T0343_unique_api_key_account'
const DATABASE = `atlas_test_unique_api_key_${process.pid}`

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

describe('unique api-key account migration', () => {
  let client: pg.Client

  const insertAccount = ({
    id,
    kind,
    createdAt,
    provider = 'inference',
    userId = 'u',
  }: {
    id: string
    kind: string
    createdAt: string
    provider?: string
    userId?: string
  }) =>
    client.query(
      `INSERT INTO "AgentAccount" (id, provider, kind, origin, label, status, "sealedSecret", "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'manual', 'l', 'active', 's', $4, $5, $5)`,
      [id, provider, kind, userId, createdAt],
    )

  const idsOf = async () =>
    (await client.query<{ id: string }>(`SELECT id FROM "AgentAccount" ORDER BY id`)).rows.map(
      (row) => row.id,
    )

  beforeAll(async () => {
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.query(`CREATE DATABASE ${quoteIdent(DATABASE)}`)
    await lane.end()
    client = new pg.Client({
      connectionString: databaseUrl({ lane: laneUrl(), name: DATABASE }),
    })
    await client.connect()
    await applyMigrations(client, { stopBefore: MIGRATION })
    for (const id of ['u', 'v', 'w']) {
      await client.query(
        `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $1, $1 || '@t.local', now())`,
        [id],
      )
    }
    await insertAccount({
      id: 'a-old-active',
      kind: 'api-key',
      createdAt: '2026-10-30T20:57:56Z',
    })
    await insertAccount({
      id: 'a-new',
      kind: 'api-key',
      createdAt: '2026-10-30T20:59:31Z',
    })
    await client.query(
      `INSERT INTO "ActiveAccount" ("userId", provider, "accountId", "updatedAt") VALUES ('u', 'inference', 'a-old-active', now())`,
    )
    await insertAccount({
      id: 'b-old',
      kind: 'api-key',
      createdAt: '2026-10-30T20:57:56Z',
      userId: 'v',
    })
    await insertAccount({
      id: 'b-new',
      kind: 'api-key',
      createdAt: '2026-10-30T20:59:31Z',
      userId: 'v',
    })
    await insertAccount({
      id: 'c-oauth-1',
      kind: 'oauth',
      createdAt: '2026-10-30T20:57:56Z',
      userId: 'w',
    })
    await insertAccount({
      id: 'c-oauth-2',
      kind: 'oauth',
      createdAt: '2026-10-30T20:59:31Z',
      userId: 'w',
    })
    await insertAccount({
      id: 'd-other-provider',
      kind: 'api-key',
      createdAt: '2026-10-30T20:57:56Z',
      provider: 'openai',
    })

    await applyMigration({ client, directory: MIGRATION })
  })

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  it('keeps the newest row even when the active pointer names an older one', async () => {
    const ids = await idsOf()
    expect(ids).toContain('a-new')
    expect(ids).not.toContain('a-old-active')
  })

  it('keeps the newest row when nothing is active', async () => {
    const ids = await idsOf()
    expect(ids).toContain('b-new')
    expect(ids).not.toContain('b-old')
  })

  it('leaves oauth accounts and other providers untouched', async () => {
    const ids = await idsOf()
    expect(ids).toEqual(expect.arrayContaining(['c-oauth-1', 'c-oauth-2', 'd-other-provider']))
  })

  it('moves the active pointer to the kept row', async () => {
    const pointer = await client.query(
      `SELECT "accountId" FROM "ActiveAccount" WHERE "userId" = 'u'`,
    )
    expect(pointer.rows[0]?.accountId).toBe('a-new')
  })

  it('rejects a second api-key account for the same user and provider', async () => {
    await expect(
      insertAccount({
        id: 'a-again',
        kind: 'api-key',
        createdAt: '2026-10-30T21:00:00Z',
      }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('still allows a second oauth account', async () => {
    await insertAccount({
      id: 'c-oauth-3',
      kind: 'oauth',
      createdAt: '2026-10-30T21:00:00Z',
      userId: 'w',
    })
    expect(await idsOf()).toContain('c-oauth-3')
  })
})
