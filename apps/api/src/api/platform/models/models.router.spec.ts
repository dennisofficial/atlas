import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { ModelsRouter } from './models.router'
import { ModelsService } from './models.service'

describe('ModelsRouter', () => {
  let app: INestApplication
  const asked: string[] = []
  let reply: { providers: never[]; liveError?: string } = { providers: [] }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        ModelsRouter,
        SessionMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer good') return null
              return { userId: 'user-a', sessionId: 's', email: '' }
            },
          },
        },
        {
          provide: ModelsService,
          useValue: {
            list: async ({ userId }: { userId: string }) => {
              asked.push(userId)
              return reply
            },
          },
        },
      ],
    })
  })

  beforeEach(() => {
    asked.length = 0
    reply = { providers: [] }
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers 401 without a session', async () => {
    await request(app.getHttpServer()).get('/v1/trpc/models.list').expect(401)
    expect(asked).toEqual([])
  })

  it('serves the signed-in user’s models from models.list', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/trpc/models.list')
      .set(as('good'))
      .expect(200)

    expect(response.body).toEqual({ result: { data: { providers: [] } } })
    expect(asked).toEqual(['user-a'])
  })

  it('keeps the optional liveError field the service returns', async () => {
    reply = { providers: [], liveError: 'codex down' }
    const response = await request(app.getHttpServer())
      .get('/v1/trpc/models.list')
      .set(as('good'))
      .expect(200)

    expect(response.body.result.data).toEqual({ providers: [], liveError: 'codex down' })
  })
})
