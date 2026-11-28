import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { z } from 'zod'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

const originalFetch = globalThis.fetch
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'google-test-key',
  alg: 'RS256',
  use: 'sig',
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('Google callback session proof', () => {
  useTestDatabase()
  let auth: typeof import('../auth.server').auth
  beforeAll(async () => {
    ;({ auth } = await import('../auth.server'))
  }, 30_000)
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('records proof only after a real Google callback creates a session', async () => {
    const email = `${randomUUID()}@test.local`
    const signed = await auth.api.signUpEmail({
      body: { email, name: 'User', password: 'a-long-enough-password' },
    })
    const existingSession = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${signed.token}` }),
    })
    expect(
      await db.orm.public.Verification.first({
        identifier: `google-session:${existingSession?.session.id}`,
      }),
    ).toBeNull()
    const { internalAdapter } = await auth.$context
    await internalAdapter.createAccount({
      userId: signed.user.id,
      providerId: 'google',
      accountId: 'google-user-1',
    })
    const begun = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: 'http://localhost:3400/confirmed' },
      asResponse: true,
    })
    const payload = z.object({ url: z.url() }).parse(await begun.json())
    const google = new URL(payload.url)
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      sub: 'google-user-1',
      email,
      email_verified: true,
      name: 'User',
      iss: 'https://accounts.google.com',
      aud: 'test-google-client-id.apps.googleusercontent.com',
      iat: now,
      exp: now + 300,
      ...(google.searchParams.has('nonce') ? { nonce: google.searchParams.get('nonce') } : {}),
    }
    const body = `${encode({ alg: 'RS256', kid: 'google-test-key' })}.${encode(claims)}`
    const idToken = `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`
    const intercepted: string[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = String(input)
        if (url === 'https://oauth2.googleapis.com/token') {
          intercepted.push('token')
          return Response.json({
            access_token: 'google-access',
            token_type: 'Bearer',
            expires_in: 300,
            id_token: idToken,
          })
        }
        if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
          intercepted.push('certs')
          return Response.json({ keys: [jwk] })
        }
        return originalFetch(input, init)
      },
      { preconnect: originalFetch.preconnect },
    )
    const cookie = begun.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const callback = await auth.handler(
      new Request(
        `http://localhost:3400/api/auth/callback/google?code=google-code&state=${google.searchParams.get('state')}`,
        { headers: { cookie } },
      ),
    )
    expect(callback.headers.get('location')).toBe('http://localhost:3400/confirmed')
    expect(intercepted).toContain('token')
    const sessions = await db.orm.public.AuthSession.where({ userId: signed.user.id }).all()
    expect(sessions).toHaveLength(2)
    const fresh = sessions.find((session) => session.id !== existingSession?.session.id)
    expect(
      await db.orm.public.Verification.first({ identifier: `google-session:${fresh?.id}` }),
    ).toMatchObject({ value: signed.user.id })
  })
})
