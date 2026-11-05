import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { Db } from '@dltech/atlas-db'

import { cipher, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { CredentialError, ECredentialFailure } from '../../model/credential-error'
import { ModelTokenService } from '../model-token-service'
import { OauthConnectionStore } from '../oauth-connection-store'
import type { StoredTokens } from '../oauth-types'

const testDb = useTestDatabase()
const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()

const stored = (over: Partial<StoredTokens> = {}): StoredTokens => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  issuedAt: iso(NOW - 3_000_000),
  expiresAt: iso(NOW + 600_000),
  ...over,
})

const seedConnection = async (args: {
  db: Db
  tokens: StoredTokens
  over?: Record<string, unknown>
}): Promise<void> => {
  await seedOwner(args.db)
  await args.db.orm.public.OauthConnection.create({
    id: 'conn-1',
    provider: 'anthropic',
    userId: 'user-1',
    authorizationId: 'conn-1',
    sealedTokens: cipher.encrypt(JSON.stringify(args.tokens)),
    ...args.over,
  })
}

const dueTokens = (): StoredTokens => stored({ expiresAt: iso(NOW + 60_000) })

const providerFake = (answer: () => Response) => {
  const bodies: unknown[] = []
  const fetchFn = async (_url: string, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body)))
    return answer()
  }
  return { bodies, fetchFn }
}

const grantResponse = (): Response =>
  new Response(
    JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 'a b' }),
    { status: 200 },
  )

const serviceOver = (fetchFn: ReturnType<typeof providerFake>['fetchFn']) =>
  new ModelTokenService({
    store: new OauthConnectionStore(testDb().db),
    cipher,
    now: () => NOW,
    fetchFn,
  })

const rowOf = () => testDb().db.orm.public.OauthConnection.first({ id: 'conn-1' })

const unsealed = async (): Promise<StoredTokens> =>
  JSON.parse(cipher.decrypt((await rowOf())?.sealedTokens ?? '')) as StoredTokens

describe('ModelTokenService', () => {
  it('returns the current token while it is fresh without calling the provider', async () => {
    await seedConnection({ db: testDb().db, tokens: stored() })
    const provider = providerFake(grantResponse)
    const issued = await serviceOver(provider.fetchFn).issue({
      userId: 'user-1',
      connectionId: 'conn-1',
    })
    expect(issued.accessToken).toBe('at-1')
    expect(issued.generation).toBe(0)
    expect(provider.bodies).toEqual([])
  })

  it('refreshes once when due, rotates the tokens and bumps the generation', async () => {
    await seedConnection({ db: testDb().db, tokens: dueTokens() })
    const provider = providerFake(grantResponse)
    const issued = await serviceOver(provider.fetchFn).issue({
      userId: 'user-1',
      connectionId: 'conn-1',
    })
    expect(issued.accessToken).toBe('at-2')
    expect(issued.generation).toBe(1)
    expect(provider.bodies).toEqual([
      {
        grant_type: 'refresh_token',
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        refresh_token: 'rt-1',
      },
    ])
    const row = await rowOf()
    expect(row?.generation).toBe(1)
    expect(row?.refreshAttempt).toBeNull()
    expect(row?.refreshStartedAt).toBeNull()
    expect(await unsealed()).toMatchObject({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      issuedAt: iso(NOW),
      expiresAt: iso(NOW + 3_600_000),
      scopes: ['a', 'b'],
    })
  })

  it('runs one provider refresh for concurrent callers on the same connection', async () => {
    await seedConnection({ db: testDb().db, tokens: dueTokens() })
    const provider = providerFake(grantResponse)
    const service = serviceOver(provider.fetchFn)
    const results = await Promise.all(
      [1, 2, 3].map(() => service.issue({ userId: 'user-1', connectionId: 'conn-1' })),
    )
    expect(provider.bodies.length).toBe(1)
    expect((await rowOf())?.generation).toBe(1)
    expect(results.every((issued) => ['at-1', 'at-2'].includes(issued.accessToken))).toBe(true)
  })

  it('uses a due but unexpired token while a v1 attempt marker is live', async () => {
    await seedConnection({
      db: testDb().db,
      tokens: dueTokens(),
      over: { refreshAttempt: 'v1-attempt', refreshStartedAt: new Date(NOW - 1_000) },
    })
    const provider = providerFake(grantResponse)
    const issued = await serviceOver(provider.fetchFn).issue({
      userId: 'user-1',
      connectionId: 'conn-1',
    })
    expect(issued.accessToken).toBe('at-1')
    expect(provider.bodies).toEqual([])
    expect((await rowOf())?.refreshAttempt).toBe('v1-attempt')
  })

  it('fails with a retryable credential error when expired and a v1 attempt is live', async () => {
    await seedConnection({
      db: testDb().db,
      tokens: stored({ expiresAt: iso(NOW - 1_000) }),
      over: { refreshAttempt: 'v1-attempt', refreshStartedAt: new Date(NOW - 1_000) },
    })
    const provider = providerFake(grantResponse)
    const failed = await serviceOver(provider.fetchFn)
      .issue({ userId: 'user-1', connectionId: 'conn-1' })
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(CredentialError)
    expect((failed as CredentialError).failure).toBe(ECredentialFailure.RefreshFailed)
    expect(provider.bodies).toEqual([])
    const row = await rowOf()
    expect(row?.refreshAttempt).toBe('v1-attempt')
    expect(row?.generation).toBe(0)
  })

  it('refreshes a fresh token the provider rejected', async () => {
    await seedConnection({ db: testDb().db, tokens: stored() })
    const provider = providerFake(grantResponse)
    const issued = await serviceOver(provider.fetchFn).issue({
      userId: 'user-1',
      connectionId: 'conn-1',
      rejectedAccessToken: 'at-1',
    })
    expect(issued.accessToken).toBe('at-2')
  })

  it('marks the connection expired when the provider rejects the refresh token', async () => {
    await seedConnection({ db: testDb().db, tokens: dueTokens() })
    const provider = providerFake(() => new Response('{}', { status: 400 }))
    const failed = await serviceOver(provider.fetchFn)
      .issue({ userId: 'user-1', connectionId: 'conn-1' })
      .catch((error: unknown) => error)
    expect((failed as CredentialError).providerRefused).toBe(true)
    const row = await rowOf()
    expect(row?.status).toBe('expired')
    expect(row?.refreshAttempt).toBeNull()
  })

  it('releases the attempt and serves the cached token when the provider is down', async () => {
    await seedConnection({ db: testDb().db, tokens: dueTokens() })
    const provider = providerFake(() => new Response('{}', { status: 429 }))
    const issued = await serviceOver(provider.fetchFn).issue({
      userId: 'user-1',
      connectionId: 'conn-1',
    })
    expect(issued.accessToken).toBe('at-1')
    expect((await rowOf())?.refreshAttempt).toBeNull()
  })

  it('does not hand out another user’s connection', async () => {
    await seedConnection({ db: testDb().db, tokens: stored() })
    const failed = await serviceOver(providerFake(grantResponse).fetchFn)
      .issue({ userId: 'someone-else', connectionId: 'conn-1' })
      .catch((error: unknown) => error)
    expect((failed as CredentialError).failure).toBe(ECredentialFailure.NotFound)
  })
})
