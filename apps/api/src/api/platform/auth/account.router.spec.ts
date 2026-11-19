import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { AccountRouter } from './account.router'

const TOKEN = 'session-a'

const me = (app: INestApplication, token: string | null = TOKEN) => {
  const call = request(app.getHttpServer()).get('/v1/trpc/account.me').query({ input: '{}' })
  return token === null ? call : call.set({ authorization: `Bearer ${token}` })
}

describe('AccountRouter', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        AccountRouter,
        SessionMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(request: { headers: { authorization?: string } }) {
              if (request.headers.authorization !== `Bearer ${TOKEN}`) return null
              return { userId: 'user-a', sessionId: 'ses-a', email: 'user-a@test.local' }
            },
          },
        },
      ],
    })
  })

  beforeEach(async () => {
    await db.orm.public.User.create({ id: 'user-a', name: 'A', email: 'user-a@test.local' })
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers me for an inactive user instead of refusing the call', async () => {
    const reply = await me(app)

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({
      userId: 'user-a',
      email: 'user-a@test.local',
      active: false,
    })
  })

  it('answers me for an active user', async () => {
    await db.orm.public.User.where({ id: 'user-a' }).updateAndCount({ active: true })

    const reply = await me(app)

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({
      userId: 'user-a',
      email: 'user-a@test.local',
      active: true,
    })
  })

  it('answers 401 without a session', async () => {
    const reply = await me(app, null)

    expect(reply.status).toBe(401)
  })
})
