import { useTestDatabase } from '@dltech/atlas-db/testing'
import { setSystemTime } from 'bun:test'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'

const REDIRECT = 'http://127.0.0.1:51234/desktop/auth/callback'

describe('DesktopAuthService', () => {
  useTestDatabase()
  let service: import('../desktop-auth.service').DesktopAuthService
  let auth: typeof import('../../auth/auth.server').auth
  let challengeOf: (verifier: string) => string
  let ttl: number
  let userId: string

  beforeAll(async () => {
    const module = await import('../desktop-auth.service')
    ;({ auth } = await import('../../auth/auth.server'))
    service = new module.DesktopAuthService()
    challengeOf = module.challengeOf
    ttl = module.CODE_TTL_MS
  })
  afterEach(() => setSystemTime())

  const grant = async () => {
    const signedUp = await auth.api.signUpEmail({
      body: {
        email: `u${Date.now()}@test.local`,
        password: 'a-long-enough-password',
        name: 'U',
      },
    })
    userId = signedUp.user.id
    const verifier = randomBytes(32).toString('base64url')
    const code = await service.authorize({
      userId,
      input: {
        redirectUri: REDIRECT,
        codeChallenge: challengeOf(verifier),
        codeChallengeMethod: 'S256',
      },
    })
    return { code, verifier }
  }

  it('exchanges a code for a bearer-usable session token and consumes it', async () => {
    const { code, verifier } = await grant()
    const token = await service.exchange({
      code,
      codeVerifier: verifier,
      redirectUri: REDIRECT,
    })
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })
    expect(session?.user.id).toBe(userId)
    await expect(
      service.exchange({ code, codeVerifier: verifier, redirectUri: REDIRECT }),
    ).rejects.toThrow('invalid')
  })

  it('rejects a wrong verifier and burns the code', async () => {
    const { code, verifier } = await grant()
    const wrong = randomBytes(32).toString('base64url')
    await expect(
      service.exchange({ code, codeVerifier: wrong, redirectUri: REDIRECT }),
    ).rejects.toThrow('invalid')
    await expect(
      service.exchange({ code, codeVerifier: verifier, redirectUri: REDIRECT }),
    ).rejects.toThrow('invalid')
  })

  it('rejects a different redirect uri', async () => {
    const { code, verifier } = await grant()
    await expect(
      service.exchange({
        code,
        codeVerifier: verifier,
        redirectUri: 'http://127.0.0.1:9/desktop/auth/callback',
      }),
    ).rejects.toThrow('invalid')
  })

  it('rejects an expired code', async () => {
    const { code, verifier } = await grant()
    setSystemTime(new Date(Date.now() + ttl + 1000))
    await expect(
      service.exchange({ code, codeVerifier: verifier, redirectUri: REDIRECT }),
    ).rejects.toThrow('invalid')
  })
})
