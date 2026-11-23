import { EClientSurface } from '@dltech/atlas-core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { PresenceReport } from './presence-registry'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { NotificationsRouter } from './notifications.router'
import { PresenceRegistry } from './presence-registry'

const reported: PresenceReport[] = []

const presence = {
  report: async (args: PresenceReport) => {
    reported.push(args)
  },
  read: async () => [],
}

const verifier = {
  async verify(req: { headers: { authorization?: string } }) {
    const userId =
      req.headers.authorization === 'Bearer s1'
        ? 'usr-1'
        : req.headers.authorization === 'Bearer s2'
          ? 'usr-2'
          : null
    return userId === null ? null : { userId, sessionId: `auth-${userId}`, email: '' }
  },
}

describe('NotificationsRouter', () => {
  let app: NestExpressApplication

  beforeEach(async () => {
    reported.length = 0
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        NotificationsRouter,
        { provide: PresenceRegistry, useValue: presence },
        SessionMiddleware,
        { provide: SESSION_VERIFIER, useValue: verifier },
      ],
    })
  })
  afterEach(() => app.close())

  const reportPresence = (args: { body: object; token?: string; batch?: boolean }) =>
    request(app.getHttpServer())
      .post('/v1/trpc/notifications.reportPresence')
      .set(args.token === undefined ? {} : as(args.token))
      .query(args.batch === true ? { batch: '1' } : {})
      .send(args.body)

  it('reports the presence of the caller', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: 'client-a', surface: 'desktop', sessionId: 'session-1', foreground: true },
    })

    expect(reply.status).toBe(200)
    expect(reported).toEqual([
      {
        userId: 'usr-1',
        clientId: 'client-a',
        surface: EClientSurface.Desktop,
        sessionId: 'session-1',
        foreground: true,
      },
    ])
  })

  it('takes the user from the session, never from the input', async () => {
    const reply = await reportPresence({
      token: 's2',
      body: {
        clientId: 'client-a',
        surface: 'ios',
        sessionId: null,
        foreground: false,
        userId: 'usr-1',
      },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('refuses a batched call', async () => {
    const reply = await reportPresence({
      token: 's1',
      batch: true,
      body: { clientId: 'client-a', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('rejects an empty client id', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: '', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('rejects an unknown surface', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: 'client-a', surface: 'tui', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('answers 401 without a session', async () => {
    const reply = await reportPresence({
      body: { clientId: 'client-a', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(401)
    expect(reported).toEqual([])
  })
})
