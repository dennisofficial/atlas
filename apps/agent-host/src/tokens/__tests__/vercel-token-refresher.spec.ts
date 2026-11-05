import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { cipher, seedOwner, seedVercel } from '../../config/__tests__/config-reader.fixture'
import { VercelReconnectRequiredError, VercelTokenRefresher } from '../vercel-token-refresher'

const testDb = useTestDatabase()
const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const OAUTH = { clientId: 'cl', clientSecret: 'secret' }

const sealedValue = (value: string): string => cipher.encrypt(JSON.stringify(value))

const seedOauth = async (over: Record<string, unknown> = {}): Promise<void> => {
  const { db } = testDb()
  await seedOwner(db)
  await seedVercel(db, {
    kind: 'oauth',
    sealedToken: sealedValue('vca-old'),
    sealedRefreshToken: sealedValue('vcr-old'),
    accessTokenExpiresAt: new Date(NOW + 10_000),
    ...over,
  })
}

const providerFake = (answer: () => Response) => {
  const bodies: string[] = []
  const fetchFn = async (_url: string, init?: RequestInit): Promise<Response> => {
    bodies.push(String(init?.body))
    return answer()
  }
  return { bodies, fetchFn }
}

const grant = (): Response =>
  new Response(
    JSON.stringify({ access_token: 'vca-new', refresh_token: 'vcr-new', expires_in: 3600 }),
    { status: 200 },
  )

const refresherOver = (
  fetchFn: ReturnType<typeof providerFake>['fetchFn'],
  oauth: typeof OAUTH | null = OAUTH,
) => new VercelTokenRefresher({ db: testDb().db, cipher, oauth, now: () => NOW, fetchFn })

const rowOf = () => testDb().db.orm.public.UserVercelCredential.first({ userId: 'user-1' })

describe('VercelTokenRefresher', () => {
  it('refreshes a near-expiry token and stores the rotated pair', async () => {
    await seedOauth()
    const provider = providerFake(grant)
    expect(await refresherOver(provider.fetchFn).refresh({ userId: 'user-1' })).toBe('vca-new')
    expect(new URLSearchParams(provider.bodies[0]).get('refresh_token')).toBe('vcr-old')
    const row = await rowOf()
    expect(JSON.parse(cipher.decrypt(row?.sealedToken ?? ''))).toBe('vca-new')
    expect(JSON.parse(cipher.decrypt(row?.sealedRefreshToken ?? ''))).toBe('vcr-new')
    expect(row?.accessTokenExpiresAt?.getTime()).toBe(NOW + 3_600_000)
  })

  it('runs one provider refresh for concurrent callers', async () => {
    await seedOauth()
    const provider = providerFake(grant)
    const refresher = refresherOver(provider.fetchFn)
    const tokens = await Promise.all([1, 2, 3].map(() => refresher.refresh({ userId: 'user-1' })))
    expect(provider.bodies.length).toBe(1)
    expect(tokens).toEqual(['vca-new', 'vca-new', 'vca-new'])
  })

  it('returns the stored token without calling the provider once another refresh landed', async () => {
    await seedOauth({ accessTokenExpiresAt: new Date(NOW + 600_000) })
    const provider = providerFake(grant)
    expect(await refresherOver(provider.fetchFn).refresh({ userId: 'user-1' })).toBe('vca-old')
    expect(provider.bodies).toEqual([])
  })

  it('flags the row for reconnect when the provider answers invalid_grant', async () => {
    await seedOauth()
    const provider = providerFake(
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    )
    await expect(
      refresherOver(provider.fetchFn).refresh({ userId: 'user-1' }),
    ).rejects.toBeInstanceOf(VercelReconnectRequiredError)
    expect((await rowOf())?.oauthNeedsReconnect).toBe(true)
  })

  it('asks for a reconnect when there is no refresh token or no oauth client', async () => {
    await seedOauth({ sealedRefreshToken: null })
    const provider = providerFake(grant)
    await expect(
      refresherOver(provider.fetchFn).refresh({ userId: 'user-1' }),
    ).rejects.toBeInstanceOf(VercelReconnectRequiredError)
    expect(provider.bodies).toEqual([])
    await expect(
      refresherOver(provider.fetchFn, null).refresh({ userId: 'user-1' }),
    ).rejects.toBeInstanceOf(VercelReconnectRequiredError)
  })

  it('keeps the row retryable when the provider fails transiently', async () => {
    await seedOauth()
    const provider = providerFake(() => new Response('{}', { status: 503 }))
    await expect(refresherOver(provider.fetchFn).refresh({ userId: 'user-1' })).rejects.toThrow()
    expect((await rowOf())?.oauthNeedsReconnect).toBe(false)
  })
})
