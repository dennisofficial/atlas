import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import {
  SandboxThreadTokenMiddleware,
  type SandboxThreadTrpcCtx,
} from './sandbox-thread-token.middleware'
import { SandboxesService } from './sandboxes.service'

const verifySessionToken = vi.fn(
  async (query: { threadId: string; token: string }): Promise<{ userId: string }> => {
    if (query.token !== 'session-token') throw new UnauthorizedException()
    return { userId: 'user-a' }
  },
)

const inputSchema = z.object({ threadId: z.string().optional() })

@Router({ alias: 'threadProbe' })
@UseMiddlewares(SandboxThreadTokenMiddleware)
class ThreadProbeRouter {
  @Mutation({
    input: inputSchema,
    output: z.object({ threadId: z.string(), userId: z.string(), token: z.string() }),
  })
  whoami(
    @Input() _input: z.infer<typeof inputSchema>,
    @Ctx() ctx: SandboxThreadTrpcCtx,
  ): { threadId: string; userId: string; token: string } {
    return { ...ctx.sandbox, token: ctx.bearerToken }
  }
}

describe('SandboxThreadTokenMiddleware', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: 100_000,
      providers: [
        ThreadProbeRouter,
        SandboxThreadTokenMiddleware,
        { provide: SandboxesService, useValue: { verifySessionToken } },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  const call = (args: { authorization?: string; body: object }) => {
    const sent = request(app.getHttpServer()).post('/v1/trpc/threadProbe.whoami')
    return (
      args.authorization === undefined ? sent : sent.set('authorization', args.authorization)
    ).send(args.body)
  }

  it('verifies the bearer token against the thread the input names', async () => {
    verifySessionToken.mockClear()

    const reply = await call({
      authorization: 'Bearer session-token',
      body: { threadId: 'brn_1' },
    })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      result: { data: { threadId: 'brn_1', userId: 'user-a', token: 'session-token' } },
    })
    expect(verifySessionToken).toHaveBeenCalledWith({ threadId: 'brn_1', token: 'session-token' })
  })

  it('refuses a request carrying no bearer token, or a non-bearer scheme', async () => {
    verifySessionToken.mockClear()

    expect((await call({ body: { threadId: 'brn_1' } })).status).toBe(401)
    expect((await call({ authorization: 'Basic abc', body: { threadId: 'brn_1' } })).status).toBe(
      401,
    )
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('refuses an input naming no thread without asking the service', async () => {
    verifySessionToken.mockClear()

    expect((await call({ authorization: 'Bearer session-token', body: {} })).status).toBe(401)
    expect(
      (await call({ authorization: 'Bearer session-token', body: { threadId: '' } })).status,
    ).toBe(401)
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('refuses a token the service does not accept for that thread', async () => {
    const reply = await call({ authorization: 'Bearer other', body: { threadId: 'brn_1' } })

    expect(reply.status).toBe(401)
  })
})
