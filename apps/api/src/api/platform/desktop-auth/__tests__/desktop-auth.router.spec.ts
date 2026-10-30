import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../../_module/trpc/trpc-middleware.fixture'
import { DesktopAuthRouter } from '../desktop-auth.router'
import { DesktopAuthService } from '../desktop-auth.service'

const service = { authorize: vi.fn(), exchange: vi.fn() }
const CHALLENGE = 'a'.repeat(43)
const GOOD = {
  redirectUri: 'http://127.0.0.1:5000/desktop/auth/callback',
  codeChallenge: CHALLENGE,
  codeChallengeMethod: 'S256',
}

describe('DesktopAuthRouter', () => {
  let app: NestExpressApplication
  beforeEach(async () => {
    service.authorize.mockReset().mockResolvedValue('code-1')
    service.exchange.mockReset().mockResolvedValue('tok')
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        DesktopAuthRouter,
        SessionMiddleware,
        { provide: DesktopAuthService, useValue: service },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              return req.headers.authorization === 'Bearer s'
                ? { userId: 'u1', sessionId: 'x', email: '' }
                : null
            },
          },
        },
      ],
    })
  })
  afterEach(() => app.close())

  const authorize = (body: object, token?: string) => {
    const sent = request(app.getHttpServer()).post('/v1/trpc/desktopAuth.authorize')
    return (token === undefined ? sent : sent.set(as(token))).send(body)
  }

  it('requires a session to mint a code', async () => {
    expect((await authorize(GOOD)).status).toBe(401)
  })

  it('mints a code for the session user', async () => {
    const res = await authorize(GOOD, 's')
    expect(res.status).toBe(200)
    expect(service.authorize).toHaveBeenCalledWith({
      userId: 'u1',
      input: GOOD,
    })
  })

  it.each([
    'https://127.0.0.1:5000/desktop/auth/callback',
    'http://localhost:5000/desktop/auth/callback',
    'http://127.0.0.1:5000/other',
    'http://127.0.0.1:5000/desktop/auth/callback?x=1',
    'http://evil.test/desktop/auth/callback',
  ])('rejects redirect_uri %s', async (redirectUri) => {
    expect((await authorize({ ...GOOD, redirectUri }, 's')).status).toBe(400)
    expect(service.authorize).not.toHaveBeenCalled()
  })

  it('rejects a non-S256 method', async () => {
    expect((await authorize({ ...GOOD, codeChallengeMethod: 'plain' }, 's')).status).toBe(400)
  })

  it('exchange is public', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/trpc/desktopAuth.exchange')
      .send({
        code: 'c',
        codeVerifier: 'v'.repeat(43),
        redirectUri: GOOD.redirectUri,
      })
    expect(res.status).toBe(200)
  })
})
