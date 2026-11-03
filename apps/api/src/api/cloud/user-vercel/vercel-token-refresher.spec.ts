import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { EnvService } from '../../../_core/config/env/env.service'
import { testCipher } from '../session-trpc-test-app'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { VercelFetcher } from './vercel-oauth.types'
import { VercelReconnectRequiredError, VercelTokenRefresher } from './vercel-token-refresher'

const HEX = { SECRETS_ENCRYPTION_KEY: 'aa'.repeat(32) }
const OAUTH_ENV = {
  ...HEX,
  VERCEL_OAUTH_CLIENT_ID: 'cl_test',
  VERCEL_OAUTH_CLIENT_SECRET: 'secret',
  BETTER_AUTH_URL: 'https://api.test',
  WEB_ORIGIN: 'https://web.test',
}

const envWith = (values: Record<string, string>) => new EnvService(values)

async function seedOauthRow(args: {
  cipher: ReturnType<typeof testCipher>
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
}) {
  await seedUser({ db, id: 'user-a' })
  await db.orm.public.UserVercelCredential.create({
    userId: 'user-a',
    kind: 'oauth',
    sealedToken: sealSecretValue({ cipher: args.cipher, value: args.accessToken }),
    sealedRefreshToken:
      args.refreshToken === null
        ? null
        : sealSecretValue({ cipher: args.cipher, value: args.refreshToken }),
    accessTokenExpiresAt: args.expiresAt,
    teamId: 'team_1',
    vercelProjectId: 'prj_1',
  })
}

describe('VercelTokenRefresher', () => {
  useTestDatabase()
  const cipher = testCipher()

  beforeEach(async () => {
    await db.orm.public.UserVercelCredential.where({ userId: 'user-a' }).deleteAndCount()
  })

  it('answers the stored access token while it is fresh', async () => {
    const fetcher = new VercelFetcher()
    fetcher.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    await seedOauthRow({
      cipher,
      accessToken: 'vca_fresh',
      refreshToken: 'vcr_1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(OAUTH_ENV), fetcher)
    expect(await refresher.accessToken({ userId: 'user-a' })).toBe('vca_fresh')
    expect(fetcher.fetch).not.toHaveBeenCalled()
  })

  it('refreshes an expired token and persists the rotated refresh token', async () => {
    const fetcher = new VercelFetcher()
    fetcher.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'vca_new', refresh_token: 'vcr_new', expires_in: 3600 }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    await seedOauthRow({
      cipher,
      accessToken: 'vca_stale',
      refreshToken: 'vcr_old',
      expiresAt: new Date(Date.now() - 1000),
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(OAUTH_ENV), fetcher)
    expect(await refresher.accessToken({ userId: 'user-a' })).toBe('vca_new')
    const row = await db.orm.public.UserVercelCredential.first({ userId: 'user-a' })
    expect(openSecretValue({ cipher, sealed: row?.sealedToken ?? '' })).toBe('vca_new')
    expect(openSecretValue({ cipher, sealed: row?.sealedRefreshToken ?? '' })).toBe('vcr_new')
    expect(row?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it('runs a single refresh when concurrent callers hit the expired token', async () => {
    let calls = 0
    const fetcher = new VercelFetcher()
    fetcher.fetch = vi.fn(async () => {
      calls += 1
      return new Response(
        JSON.stringify({
          access_token: `vca_rotated_${calls}`,
          refresh_token: `vcr_rotated_${calls}`,
          expires_in: 3600,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    await seedOauthRow({
      cipher,
      accessToken: 'vca_stale',
      refreshToken: 'vcr_old',
      expiresAt: new Date(Date.now() - 1000),
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(OAUTH_ENV), fetcher)
    const tokens = await Promise.all([
      refresher.accessToken({ userId: 'user-a' }),
      refresher.accessToken({ userId: 'user-a' }),
      refresher.accessToken({ userId: 'user-a' }),
    ])
    expect(calls).toBe(1)
    expect(new Set(tokens).size).toBe(1)
    expect(tokens[0]).toBe('vca_rotated_1')
    const row = await db.orm.public.UserVercelCredential.first({ userId: 'user-a' })
    expect(openSecretValue({ cipher, sealed: row?.sealedRefreshToken ?? '' })).toBe('vcr_rotated_1')
  })

  it('flags needs-reconnect on invalid_grant and refuses afterwards', async () => {
    const fetcher = new VercelFetcher()
    fetcher.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'revoked' }), {
          status: 400,
        }),
    ) as unknown as typeof fetch
    await seedOauthRow({
      cipher,
      accessToken: 'vca_stale',
      refreshToken: 'vcr_dead',
      expiresAt: new Date(Date.now() - 1000),
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(OAUTH_ENV), fetcher)
    await expect(refresher.accessToken({ userId: 'user-a' })).rejects.toBeInstanceOf(
      VercelReconnectRequiredError,
    )
    const row = await db.orm.public.UserVercelCredential.first({ userId: 'user-a' })
    expect(row?.oauthNeedsReconnect).toBe(true)
    await expect(refresher.accessToken({ userId: 'user-a' })).rejects.toBeInstanceOf(
      VercelReconnectRequiredError,
    )
    expect(fetcher.fetch).toHaveBeenCalledTimes(1)
  })

  it('requires the oauth client env before refreshing', async () => {
    await seedOauthRow({
      cipher,
      accessToken: 'vca_stale',
      refreshToken: 'vcr_old',
      expiresAt: new Date(Date.now() - 1000),
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(HEX), new VercelFetcher())
    await expect(refresher.accessToken({ userId: 'user-a' })).rejects.toBeInstanceOf(
      VercelReconnectRequiredError,
    )
  })

  it('reads token-kind rows straight from the sealed token', async () => {
    await seedUser({ db, id: 'user-b' })
    await db.orm.public.UserVercelCredential.create({
      userId: 'user-b',
      kind: 'token',
      sealedToken: sealSecretValue({ cipher, value: 'vtok_plain' }),
      teamId: 'team_1',
      vercelProjectId: 'prj_1',
    })
    const refresher = new VercelTokenRefresher(cipher, envWith(HEX), new VercelFetcher())
    expect(await refresher.accessToken({ userId: 'user-b' })).toBe('vtok_plain')
  })

  it('reports whether oauth is configured', () => {
    const refresher = new VercelTokenRefresher(cipher, envWith(HEX), new VercelFetcher())
    expect(refresher.oauthConfigured()).toBe(false)
    const configured = new VercelTokenRefresher(cipher, envWith(OAUTH_ENV), new VercelFetcher())
    expect(configured.oauthConfigured()).toBe(true)
  })
})
