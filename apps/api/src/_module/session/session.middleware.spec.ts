import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../_core/types/auth.types'
import { meta } from '../trpc/procedure-meta'
import { createMiddlewareApp, UNTHROTTLED_RATE_LIMIT } from '../trpc/trpc-middleware.fixture'
import { SessionMiddleware, type SessionTrpcCtx } from './session.middleware'
import type { INestApplication } from '@nestjs/common'

const SESSION: VerifiedSession = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'dennis@atlas.dev',
  activeOrganizationId: null,
}

const verify = vi.fn(
  async (request: { headers: { cookie?: string | undefined } }): Promise<VerifiedSession | null> =>
    request.headers.cookie === 'ok' ? SESSION : null,
)

@Router({ alias: 'probe' })
@UseMiddlewares(SessionMiddleware)
class ProbeRouter {
  @Query({ output: z.object({ userId: z.string() }) })
  whoami(@Ctx() ctx: SessionTrpcCtx): { userId: string } {
    return { userId: ctx.auth.userId }
  }

  @Query({ output: z.string(), meta: meta({ public: true }) })
  open(): string {
    return 'open'
  }
}

describe('SessionMiddleware', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        ProbeRouter,
        SessionMiddleware,
        { provide: SESSION_VERIFIER, useValue: { verify } },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('puts the verified session on ctx.auth', async () => {
    const reply = await request(app.getHttpServer())
      .get('/v1/trpc/probe.whoami')
      .set('cookie', 'ok')

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { userId: 'user-1' } } })
  })

  it('answers 401 when there is no session', async () => {
    const reply = await request(app.getHttpServer()).get('/v1/trpc/probe.whoami')

    expect(reply.status).toBe(401)
  })

  it('skips verification on a public procedure', async () => {
    verify.mockClear()

    const reply = await request(app.getHttpServer()).get('/v1/trpc/probe.open')

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: 'open' } })
    expect(verify).not.toHaveBeenCalled()
  })
})
