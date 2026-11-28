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
    if (session === null) throw new Error('missing session')
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
