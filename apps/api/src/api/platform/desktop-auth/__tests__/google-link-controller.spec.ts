import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { z } from 'zod'
import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { BrowserReturnService } from '../../../../agent'
import { EnvService } from '../../../../_core/config/env/env.service'
import { GoogleLinkController } from '../google-link.controller'
import { GoogleLinkService } from '../google-link.service'

const KEY = 'b'.repeat(64)
const API = 'http://localhost:3400'
const WEB = 'http://localhost:3001'

describe('Google link browser endpoints', () => {
  useTestDatabase()
  let app: NestExpressApplication
  let service: GoogleLinkService
  let auth: typeof import('../../auth/auth.server').auth
  let state: string
  let token: string
  let userId: string
  let sessionId: string
  beforeAll(async () => {
    ;({ auth } = await import('../../auth/auth.server'))
  }, 30_000)
  beforeEach(async () => {
    service = new GoogleLinkService(
      new EnvService({
        SECRETS_ENCRYPTION_KEY: KEY,
        BETTER_AUTH_URL: API,
        WEB_ORIGIN: WEB,
      }),
    )
    const module = await Test.createTestingModule({
      controllers: [GoogleLinkController],
      providers: [{ provide: GoogleLinkService, useValue: service }],
    }).compile()
    app = module.createNestApplication<NestExpressApplication>()
    await app.init()
    const signed = await auth.api.signUpEmail({
      body: {
        name: 'User',
        email: `${randomUUID()}@test.local`,
        password: 'a-long-enough-password',
      },
    })
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${signed.token}` }),
    })
    if (session === null || signed.token === null) throw new Error('missing session')
    token = signed.token
    userId = signed.user.id
    sessionId = session.session.id
    const url = new URL(
      await service.begin({ userId: signed.user.id, sessionId: session.session.id }),
    )
    state = url.pathname.split('/').at(-1) ?? ''
  })
  afterEach(() => app.close())

  it('sets the OAuth cookies in the browser before redirecting to Google', async () => {
    const response = await request(app.getHttpServer()).get(`/google-link/start?state=${state}`)
    expect(response.status).toBe(302)
    expect(new URL(response.headers.location ?? '').hostname).toBe('accounts.google.com')
    expect(z.array(z.string()).parse(response.headers['set-cookie']).join(';')).toContain('state')
    expect(response.headers['cache-control']).toBe('no-store')
    const duplicate = await request(app.getHttpServer()).get(`/google-link/start?state=${state}`)
    expect(duplicate.status).toBe(302)
    expect(new URL(duplicate.headers.location ?? '').searchParams.get('atlasReturn')).toBe('failed')
  })

  it.each([
    { ageDays: 0, foreignBrowser: false },
    { ageDays: 2, foreignBrowser: false },
    { ageDays: 0, foreignBrowser: true },
    { ageDays: 2, foreignBrowser: true },
  ])('does not disclose or replace a session for %j', async ({ ageDays, foreignBrowser }) => {
    const context = await auth.$context
    if (ageDays > 0) {
      const ageMs = ageDays * 24 * 60 * 60_000
      await context.internalAdapter.updateSession(token, {
        createdAt: new Date(Date.now() - ageMs),
        updatedAt: new Date(Date.now() - ageMs),
        expiresAt: new Date(Date.now() + context.sessionConfig.expiresIn * 1000 - ageMs),
      })
    }
    const browser = foreignBrowser
      ? await auth.api.signUpEmail({
          body: {
            name: 'Other user',
            email: `${randomUUID()}@test.local`,
            password: 'another-long-enough-password',
          },
          asResponse: true,
        })
      : undefined
    const browserCookie = browser?.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const before = browserCookie
      ? await auth.api.getSession({ headers: new Headers({ cookie: browserCookie }) })
      : null
    if (foreignBrowser) {
      expect(before).not.toBeNull()
      expect(before?.user.id).not.toBe(userId)
    }
    const pending = request(app.getHttpServer()).get(`/google-link/start?state=${state}`)
    if (browserCookie) pending.set('Cookie', browserCookie)
    const response = await pending
    expect(response.status).toBe(302)
    const location = z.string().parse(response.headers.location)
    const google = new URL(location)
    expect(google.hostname).toBe('accounts.google.com')
    const cookies = z.array(z.string()).parse(response.headers['set-cookie'])
    const exposed = [...cookies, location, response.text]
    for (const value of exposed) {
      expect(value).not.toContain(token)
      for (const encoded of value.match(/[A-Za-z0-9_-]{16,}/g) ?? []) {
        expect(Buffer.from(encoded, 'base64url').toString()).not.toContain(token)
      }
    }
    const stateCookie = context.createAuthCookie(
      context.oauthConfig.storeStateStrategy === 'cookie' ? 'oauth_state' : 'state',
    ).name
    expect(cookies.map((cookie) => cookie.slice(0, cookie.indexOf('=')))).toEqual([stateCookie])
    expect(response.headers['set-auth-token']).toBeUndefined()
    const oauthState = google.searchParams.get('state')
    if (oauthState === null) throw new Error('missing OAuth state')
    const verification = await context.internalAdapter.findVerificationValue(oauthState)
    expect(JSON.parse(verification?.value ?? '{}')).toMatchObject({ link: { userId } })
    expect(await db.orm.public.AuthSession.first({ id: sessionId })).toMatchObject({
      token,
      userId,
    })
    if (browserCookie) {
      const after = await auth.api.getSession({ headers: new Headers({ cookie: browserCookie }) })
      expect(after?.session.id).toBe(before?.session.id)
      expect(after?.user.id).toBe(before?.user.id)
    }
  })

  it('returns a refused Google link through the existing iOS framework target', async () => {
    const returns = new BrowserReturnService({
      db,
      cipher: new SecretCipher(KEY),
      publicUrl: API,
      webOrigin: WEB,
    })
    const started = await returns.start({ state, surface: 'ios' })
    if (started.kind !== 'redirect') throw new Error('expected start')
    const response = await request(app.getHttpServer())
      .get(`/google-link/callback?state=${state}&error=email_does_not_match`)
      .set('Cookie', started.cookie.split(';')[0] ?? '')
    expect(response.status).toBe(200)
    const assigned = /location.href = ("[^"]*")/.exec(response.text)?.[1]
    if (assigned === undefined) throw new Error('missing iOS return')
    const target = new URL(JSON.parse(assigned))
    expect(target.protocol).toBe('atlas:')
    expect(target.pathname).toContain('/account')
    expect(target.searchParams.get('atlasReturn')).toBe('failed')
    expect(target.searchParams.get('atlasState')).toBe(state)
    expect(target.searchParams.get('atlasReason')).toBe('email_does_not_match')
    expect(z.array(z.string()).parse(response.headers['set-cookie']).join(';')).toContain(
      'Max-Age=0',
    )
  })
})
