import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { z } from 'zod'
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../../_core/config/env/env.service'

const ORIGIN = 'http://localhost:3400'

describe('Google link browser bootstrap', () => {
  useTestDatabase()
  let service: import('../google-link.service').GoogleLinkService
  let auth: typeof import('../../auth/auth.server').auth
  let userId: string
  let sessionId: string
  let token: string

  beforeAll(async () => {
    const { GoogleLinkService } = await import('../google-link.service')
    ;({ auth } = await import('../../auth/auth.server'))
    service = new GoogleLinkService(
      new EnvService({
        WEB_ORIGIN: 'http://localhost:3001',
        BETTER_AUTH_URL: ORIGIN,
        SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
      }),
    )
  })

  beforeEach(async () => {
    const signed = await auth.api.signUpEmail({
      body: {
        email: `${randomUUID()}@test.local`,
        name: 'User',
        password: 'a-long-enough-password',
      },
    })
    userId = signed.user.id
    token = signed.token ?? ''
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })
    if (session === null) throw new Error('missing test session')
    sessionId = session.session.id
  })

  const begin = async () => {
    const url = new URL(await service.begin({ userId, sessionId }))
    const state = url.pathname.split('/').at(-1)
    if (state === undefined) throw new Error('missing state')
    return { state, url }
  }

  it('returns a framework start link, never a provider URL or bearer', async () => {
    const { url } = await begin()
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toStartWith('/return/start/')
    expect(url.toString()).not.toContain(token)
  })

  it('starts Google for the bearer user and forwards the OAuth state cookie', async () => {
    const { state } = await begin()
    const response = await service.start(state)
    expect(response.ok).toBe(true)
    const payload = z.object({ url: z.url() }).parse(await response.json())
    const google = new URL(payload.url)
    expect(google.hostname).toBe('accounts.google.com')
    expect(response.headers.getSetCookie().join(';')).toContain('state')
    expect(google.searchParams.get('redirect_uri')).toContain('/api/auth/callback/google')
    await expect(service.start(state)).rejects.toThrow('expired')
  })

  it('rejects an expired or different-user bearer session before beginning', async () => {
    await expect(service.begin({ userId: 'other', sessionId })).rejects.toThrow('Sign in again')
    await auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${token}` }) })
    await expect(service.begin({ userId, sessionId })).rejects.toThrow('Sign in again')
  })

  it('never stores a plaintext bearer in the bootstrap record', async () => {
    const { state } = await begin()
    const row = await db.orm.public.Verification.first({ identifier: `google-link-start:${state}` })
    expect(row?.value).not.toContain(token)
  })

  it('cannot report success before Google is actually linked', async () => {
    const { state } = await begin()
    const answer = await service.callback({ state, error: undefined, cookieHeader: undefined })
    expect(answer.kind).toBe('redirect')
    if (answer.kind === 'redirect')
      expect(new URL(answer.location).searchParams.get('atlasReturn')).toBe('failed')
  })

  it('returns linked after the expected user gains Google', async () => {
    const { state } = await begin()
    const { internalAdapter } = await auth.$context
    await internalAdapter.createAccount({ userId, providerId: 'google', accountId: randomUUID() })
    const answer = await service.callback({ state, error: undefined, cookieHeader: undefined })
    if (answer.kind !== 'redirect') throw new Error('expected web return')
    expect(new URL(answer.location).searchParams.get('atlasReturn')).toBe('connected')
    const duplicate = await service.callback({ state, error: undefined, cookieHeader: undefined })
    if (duplicate.kind === 'redirect')
      expect(new URL(duplicate.location).searchParams.get('atlasReturn')).toBe('failed')
  })

  it('preserves provider error codes for the shared client outcome copy', async () => {
    const { state } = await begin()
    const answer = await service.callback({
      state,
      error: 'email_does_not_match',
      cookieHeader: undefined,
    })
    if (answer.kind !== 'redirect') throw new Error('expected web return')
    expect(new URL(answer.location).searchParams.get('atlasReason')).toBe('email_does_not_match')
  })
})
