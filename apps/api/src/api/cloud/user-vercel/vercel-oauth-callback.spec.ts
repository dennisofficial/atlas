import { describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { EnvService } from '../../../_core/config/env/env.service'
import { testCipher } from '../session-trpc-test-app'
import { openSecretValue } from '../secrets/sealed-secret'
import { UserVercelService } from './user-vercel.service'
import { VercelPlanService } from './vercel-credential-plan'
import { VercelFetcher, VercelOauthConfig } from './vercel-oauth.types'
import { VercelTokenRefresher } from './vercel-token-refresher'
import { EVercelConnectStartOutcome } from '@dltech/atlas-wire/web'

const ENV = {
  SECRETS_ENCRYPTION_KEY: 'aa'.repeat(32),
  VERCEL_OAUTH_CLIENT_ID: 'cl_test',
  VERCEL_OAUTH_CLIENT_SECRET: 'secret',
  BETTER_AUTH_URL: 'https://api.test',
  WEB_ORIGIN: 'https://web.test',
}

const routes: Record<string, { status?: number; json: unknown }> = {}
const fetcher = () => {
  const stub = new VercelFetcher()
  stub.fetch = vi.fn(async (input: string) => {
    const url = String(input)
    if (url === 'https://api.vercel.com/login/oauth/token') {
      return new Response(
        JSON.stringify({ access_token: 'vca_1', refresh_token: 'vcr_1', expires_in: 3600 }),
        { status: 200 },
      )
    }
    const key = Object.keys(routes).find((path) => url.startsWith(path))
    if (key === undefined) return new Response('{}', { status: 404 })
    const reply = routes[key] as { status?: number; json: unknown }
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 })
  }) as unknown as typeof fetch
  return stub
}

const serviceWith = (fetch: VercelFetcher, env: Record<string, string> = ENV) => {
  const cipher = testCipher()
  const config = new VercelOauthConfig()
  config.redirectUri = 'https://api.test/v1/vercel/oauth/callback'
  config.webOrigin = 'https://web.test'
  const refresher = new VercelTokenRefresher(cipher, new EnvService(env), fetch)
  const plans = new VercelPlanService(cipher, refresher, fetch)
  return new UserVercelService(cipher, new EnvService(env), refresher, plans, config, fetch)
}

describe('UserVercelService oauth flow', () => {
  useTestDatabase()
  const cipher = testCipher()

  it('connectStart answers not-configured without the client env', async () => {
    const service = serviceWith(fetcher(), {
      SECRETS_ENCRYPTION_KEY: ENV.SECRETS_ENCRYPTION_KEY,
      BETTER_AUTH_URL: ENV.BETTER_AUTH_URL,
      WEB_ORIGIN: ENV.WEB_ORIGIN,
    })
    const result = await service.connectStart({ userId: 'user-a' })
    expect(result.outcome).toBe(EVercelConnectStartOutcome.NotConfigured)
  })

  it('connectStart stores a pending row and returns the authorize url', async () => {
    await seedUser({ db, id: 'user-a' })
    const service = serviceWith(fetcher())
    const result = await service.connectStart({ userId: 'user-a' })
    if (result.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const url = new URL(result.url)
    expect(url.origin + url.pathname).toBe('https://vercel.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cl_test')
    const state = url.searchParams.get('state')
    expect(state).not.toBeNull()
    const pending = await db.orm.public.McpOauthPending.first({ id: state ?? '' })
    expect(pending?.userId).toBe('user-a')
  })

  it('completeCallback rejects an unknown state', async () => {
    const service = serviceWith(fetcher())
    const location = await service.completeCallback({
      state: 'nope',
      code: 'c',
      sessionUserId: 'user-a',
    })
    expect(location).toContain('/settings/usage-sandboxes?vercel=error')
    expect(location).toContain('reason=unknown_state')
  })

  it('completeCallback rejects a session mismatch and an expired pending', async () => {
    await seedUser({ db, id: 'user-a' })
    const service = serviceWith(fetcher())
    const started = await service.connectStart({ userId: 'user-a' })
    if (started.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const state = new URL(started.url).searchParams.get('state') ?? ''
    const mismatch = await service.completeCallback({ state, code: 'c', sessionUserId: 'user-b' })
    expect(mismatch).toContain('reason=session_mismatch')

    const second = await service.connectStart({ userId: 'user-a' })
    if (second.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const secondState = new URL(second.url).searchParams.get('state') ?? ''
    await db.orm.public.McpOauthPending.where({ id: secondState }).updateAndCount({
      expiresAt: new Date(Date.now() - 1000),
    })
    const expired = await service.completeCallback({
      state: secondState,
      code: 'c',
      sessionUserId: 'user-a',
    })
    expect(expired).toContain('reason=expired')
  })

  it('completes a one-project connect and stores a sealed oauth credential', async () => {
    await seedUser({ db, id: 'user-a' })
    routes['https://api.vercel.com/login/oauth/userinfo'] = { json: { sub: 'vuser_1' } }
    routes['https://api.vercel.com/v2/teams'] = {
      json: { teams: [{ id: 'team_1', slug: 'acme', billing: { plan: 'enterprise' } }] },
    }
    routes['https://api.vercel.com/v9/projects'] = {
      json: { projects: [{ id: 'prj_1', name: 'web' }] },
    }
    const service = serviceWith(fetcher())
    const started = await service.connectStart({ userId: 'user-a' })
    if (started.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const state = new URL(started.url).searchParams.get('state') ?? ''
    const location = await service.completeCallback({
      state,
      code: 'code',
      sessionUserId: 'user-a',
    })
    expect(location).toBe('https://web.test/settings/usage-sandboxes?vercel=connected')
    const row = await db.orm.public.UserVercelCredential.first({ userId: 'user-a' })
    expect(row).toMatchObject({
      kind: 'oauth',
      teamId: 'team_1',
      vercelProjectId: 'prj_1',
      plan: 'enterprise',
      vercelUserId: 'vuser_1',
      oauthNeedsReconnect: false,
    })
    expect(openSecretValue({ cipher, sealed: row?.sealedToken ?? '' })).toBe('vca_1')
    expect(openSecretValue({ cipher, sealed: row?.sealedRefreshToken ?? '' })).toBe('vcr_1')
  })

  it('redirects to choose-project when the grant covers several projects', async () => {
    await seedUser({ db, id: 'user-b' })
    routes['https://api.vercel.com/login/oauth/userinfo'] = { json: { sub: 'vuser_2' } }
    routes['https://api.vercel.com/v2/teams'] = {
      json: { teams: [{ id: 'team_1', slug: 'acme', billing: { plan: 'pro' } }] },
    }
    routes['https://api.vercel.com/v9/projects'] = {
      json: {
        projects: [
          { id: 'prj_1', name: 'web' },
          { id: 'prj_2', name: 'api' },
        ],
      },
    }
    const service = serviceWith(fetcher())
    const started = await service.connectStart({ userId: 'user-b' })
    if (started.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const state = new URL(started.url).searchParams.get('state') ?? ''
    const location = await service.completeCallback({
      state,
      code: 'code',
      sessionUserId: 'user-b',
    })
    expect(location).toBe('https://web.test/settings/usage-sandboxes?vercel=choose-project')
    const row = await db.orm.public.UserVercelCredential.first({ userId: 'user-b' })
    expect(row?.vercelProjectId).toBeNull()
    expect(row?.plan).toBe('pro')
  })

  it('a failed exchange lands on the error redirect and stores nothing', async () => {
    await seedUser({ db, id: 'user-c' })
    const stub = new VercelFetcher()
    stub.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    ) as unknown as typeof fetch
    const service = serviceWith(stub)
    const started = await service.connectStart({ userId: 'user-c' })
    if (started.outcome !== EVercelConnectStartOutcome.Redirect)
      throw new Error('expected a redirect')
    const state = new URL(started.url).searchParams.get('state') ?? ''
    const location = await service.completeCallback({
      state,
      code: 'code',
      sessionUserId: 'user-c',
    })
    expect(location).toContain('vercel=error')
    expect(await db.orm.public.UserVercelCredential.first({ userId: 'user-c' })).toBeNull()
  })
})
