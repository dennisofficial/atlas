import { createHash, randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { recordGoogleSession } from '../../auth/google-session'
import { EnvService } from '../../../../_core/config/env/env.service'

const VERIFIER = 'v'.repeat(43)
const INPUT = {
  redirectUri: 'atlas://auth/callback',
  codeChallenge: createHash('sha256').update(VERIFIER).digest('base64url'),
  codeChallengeMethod: 'S256' as const,
  state: 'client-state',
}

describe('Google confirmation grants', () => {
  useTestDatabase()
  let service: import('../desktop-auth.service').DesktopAuthService
  let auth: typeof import('../../auth/auth.server').auth
  let userId: string

  beforeAll(async () => {
    const { DesktopAuthService } = await import('../desktop-auth.service')
    ;({ auth } = await import('../../auth/auth.server'))
    service = new DesktopAuthService(new EnvService({ WEB_ORIGIN: 'https://byatlas.io' }))
  }, 30_000)

  beforeEach(async () => {
    const signed = await auth.api.signUpEmail({
      body: {
        email: `${randomUUID()}@test.local`,
        name: 'User',
        password: 'a-long-enough-password',
      },
    })
    userId = signed.user.id
  })

  const link = async () => {
    const { internalAdapter } = await auth.$context
    await internalAdapter.createAccount({ userId, providerId: 'google', accountId: randomUUID() })
  }

  const begin = async () => {
    await link()
    const url = new URL(await service.beginGoogleReauth({ userId, input: INPUT }))
    const nonce = url.searchParams.get('google_reauth')
    if (nonce === null) throw new Error('missing nonce')
    const sessionId = randomUUID()
    await recordGoogleSession({ sessionId, userId, path: '/callback/:id', provider: 'google' })
    return { nonce, url, sessionId }
  }

  it('refuses confirmation when Google is not linked', async () => {
    await expect(service.beginGoogleReauth({ userId, input: INPUT })).rejects.toThrow('Link Google')
  })

  it('returns the existing authorize path with Google sign-in forced and PKCE bound', async () => {
    const { url } = await begin()
    expect(url.origin).toBe('https://byatlas.io')
    expect(url.pathname).toBe('/desktop/authorize')
    expect(url.searchParams.get('google_start')).toBe('1')
    expect(url.searchParams.get('state')).toBe(INPUT.state)
    expect(url.searchParams.get('code_challenge')).toBe(INPUT.codeChallenge)
  })

  it('refuses an old browser cookie rather than silently minting a fresh grant', async () => {
    const { nonce, sessionId } = await begin()
    await expect(
      service.authorize({
        userId,
        sessionId,
        input: { ...INPUT, googleReauth: nonce },
        sessionCreatedAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toThrow('Sign in again')
  })

  it.each(['user', 'challenge', 'redirect', 'missing-session'])(
    'refuses a mismatched %s',
    async (mismatch) => {
      const { nonce, sessionId } = await begin()
      await expect(
        service.authorize({
          sessionId,
          userId: mismatch === 'user' ? 'other-user' : userId,
          sessionCreatedAt: mismatch === 'missing-session' ? undefined : new Date(Date.now() + 1),
          input: {
            ...INPUT,
            googleReauth: nonce,
            ...(mismatch === 'challenge' ? { codeChallenge: 'x'.repeat(43) } : {}),
            ...(mismatch === 'redirect'
              ? { redirectUri: 'http://127.0.0.1:4000/desktop/auth/callback' }
              : {}),
          },
        }),
      ).rejects.toThrow('Sign in again')
    },
  )

  it('accepts a genuinely fresh same-user session and consumes its nonce once', async () => {
    const { nonce, sessionId } = await begin()
    const args = {
      userId,
      sessionId,
      input: { ...INPUT, googleReauth: nonce },
      sessionCreatedAt: new Date(Date.now() + 1),
    }
    const code = await service.authorize(args)
    const token = await service.exchange({
      code,
      codeVerifier: VERIFIER,
      redirectUri: INPUT.redirectUri,
      requireGoogleReauth: true,
    })
    expect(token).toBeTruthy()
    await expect(service.authorize(args)).rejects.toThrow('expired')
  })

  it('refuses even a fresh password session without a Google callback proof', async () => {
    const { nonce } = await begin()
    await expect(
      service.authorize({
        userId,
        sessionId: 'password-session',
        input: { ...INPUT, googleReauth: nonce },
        sessionCreatedAt: new Date(Date.now() + 1),
      }),
    ).rejects.toThrow('Sign in again')
  })

  it('expires the Google confirmation nonce', async () => {
    const { nonce } = await begin()
    await db.orm.public.Verification.where({ identifier: `google-reauth:${nonce}` }).update({
      expiresAt: new Date(0),
    })
    await expect(
      service.authorize({
        userId,
        input: { ...INPUT, googleReauth: nonce },
        sessionCreatedAt: new Date(),
      }),
    ).rejects.toThrow('expired')
  })
})
