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
import { GoogleAccountRouter } from '../google-account.router'
import { GoogleLinkService } from '../google-link.service'

const begin = vi.fn()

describe('GoogleAccountRouter', () => {
  let app: NestExpressApplication
  beforeEach(async () => {
    begin.mockReset().mockResolvedValue('https://api.byatlas.io/return/start/state')
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        GoogleAccountRouter,
        SessionMiddleware,
        { provide: GoogleLinkService, useValue: { begin } },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              return req.headers.authorization === 'Bearer s'
                ? { userId: 'u1', sessionId: 's1', email: 'u1@test.local' }
                : null
            },
          },
        },
      ],
    })
  })
  afterEach(() => app.close())

  it('requires an authenticated account and rejects user-controlled callback URLs', async () => {
    const send = () => request(app.getHttpServer()).post('/v1/trpc/googleAccount.beginLink')
    expect((await send().send({})).status).toBe(401)
    expect((await send().set(as('s')).send({ callbackURL: 'https://evil.test' })).status).toBe(400)
    expect(begin).not.toHaveBeenCalled()
    const response = await send().set(as('s')).send({})
    expect(response.status).toBe(200)
    expect(begin).toHaveBeenCalledWith({ userId: 'u1', sessionId: 's1' })
    expect(response.body.result.data.url).toBe('https://api.byatlas.io/return/start/state')
  })
})
