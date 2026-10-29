import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../../_core/types/auth.types'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from './session-or-sandbox.middleware'

const SESSION: VerifiedSession = {
  userId: 'user-session',
  sessionId: 'ses_better-auth',
  email: 'dennis@atlas.dev',
}

const SANDBOX_TOKEN = 'sandbox-token'
const POD_TOKEN = 'pod-token'

const verify = vi.fn(
  async (request: { headers: { cookie?: string | undefined } }): Promise<VerifiedSession | null> =>
    request.headers.cookie === 'ok' ? SESSION : null,
)

const assertThreadInFamily = vi.fn(
  async ({ sandboxThreadId, threadId }: { sandboxThreadId: string; threadId: string }) => {
    if (threadId !== sandboxThreadId && threadId !== 'thr-child') throw new UnauthorizedException()
  },
)

const sandboxes = {
  async verifyTokenPrincipal({ token }: { token: string }) {
    if (token === SANDBOX_TOKEN) {
      return { kind: ETokenPrincipalKind.Sandbox, id: 'sbx-1', threadId: 'thr-1', userId: 'usr-1' }
    }
    if (token === POD_TOKEN) {
      return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'usr-1' }
    }
    throw new UnauthorizedException()
  },
  assertThreadInFamily,
}

const callerOf = z.object({
  sessionId: z.string(),
  sandbox: z.string().nullable(),
  pod: z.string().nullable(),
})
type Caller = z.infer<typeof callerOf>

const callerFrom = (ctx: SessionOrSandboxTrpcCtx): Caller => ({
  sessionId: ctx.auth.sessionId,
  sandbox: ctx.sandbox?.sandboxId ?? null,
  pod: ctx.pod?.threadId ?? null,
})

@Router({ alias: 'probe' })
@UseMiddlewares(SessionOrSandboxMiddleware)
class ProbeRouter {
  @Mutation({ input: z.object({ threadId: z.string() }), output: callerOf })
  forThread(@Input() _input: { threadId: string }, @Ctx() ctx: SessionOrSandboxTrpcCtx): Caller {
    return callerFrom(ctx)
  }

  @Mutation({ output: callerOf })
  threadless(@Ctx() ctx: SessionOrSandboxTrpcCtx): Caller {
    return callerFrom(ctx)
  }

  @Mutation({ output: callerOf, meta: meta({ sandboxReachable: true }) })
  sandboxOpen(@Ctx() ctx: SessionOrSandboxTrpcCtx): Caller {
    return callerFrom(ctx)
  }

  @Mutation({ output: callerOf, meta: meta({ podReachable: true }) })
  podOpen(@Ctx() ctx: SessionOrSandboxTrpcCtx): Caller {
    return callerFrom(ctx)
  }

  @Mutation({
    input: z.object({ threadId: z.string() }),
    output: callerOf,
    meta: meta({ podReachable: true }),
  })
  podThreaded(@Input() _input: { threadId: string }, @Ctx() ctx: SessionOrSandboxTrpcCtx): Caller {
    return callerFrom(ctx)
  }

  @Mutation({ output: z.string(), meta: meta({ public: true }) })
  open(): string {
    return 'open'
  }
}

describe('SessionOrSandboxMiddleware', () => {
  let app: INestApplication
  const post = ({
    procedure,
    headers = {},
    body = {},
  }: {
    procedure: string
    headers?: Record<string, string>
    body?: object
  }) => request(app.getHttpServer()).post(`/v1/trpc/probe.${procedure}`).set(headers).send(body)

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        ProbeRouter,
        SessionOrSandboxMiddleware,
        { provide: SESSION_VERIFIER, useValue: { verify } },
        { provide: SandboxesService, useValue: sandboxes },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('serves a public procedure with no credentials', async () => {
    const reply = await post({ procedure: 'open' })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: 'open' } })
  })

  it('authenticates the user session when no token is sent', async () => {
    const reply = await post({ procedure: 'threadless', headers: { cookie: 'ok' } })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({
      sessionId: 'ses_better-auth',
      sandbox: null,
      pod: null,
    })
  })

  it('answers 401 when there is neither token nor session', async () => {
    expect((await post({ procedure: 'threadless' })).status).toBe(401)
  })

  it('falls through to the session when the bearer is not a sandbox or pod token', async () => {
    const reply = await post({
      procedure: 'threadless',
      headers: { ...as('session-token'), cookie: 'ok' },
    })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data.sessionId).toBe('ses_better-auth')
  })

  it('answers 401 for an unknown bearer without a session', async () => {
    expect((await post({ procedure: 'threadless', headers: as('nope') })).status).toBe(401)
  })

  it('answers 403 for a pod token on a sandboxReachable-only threadless route', async () => {
    const reply = await post({ procedure: 'sandboxOpen', headers: as(POD_TOKEN) })

    expect(reply.status).toBe(403)
  })

  it('answers 403 for a pod token on a threadless route with no reach meta', async () => {
    const reply = await post({ procedure: 'threadless', headers: as(POD_TOKEN) })

    expect(reply.status).toBe(403)
  })

  it('answers 403 for a pod token naming its own or a child thread on a non-podReachable route', async () => {
    assertThreadInFamily.mockClear()

    for (const threadId of ['thr-1', 'thr-child', 'thr-other']) {
      const reply = await post({
        procedure: 'forThread',
        headers: as(POD_TOKEN),
        body: { threadId },
      })
      expect(reply.status).toBe(403)
    }
    expect(assertThreadInFamily).not.toHaveBeenCalled()
  })

  it('admits a pod token on a podReachable route even when the input names a thread', async () => {
    const reply = await post({
      procedure: 'podThreaded',
      headers: as(POD_TOKEN),
      body: { threadId: 'thr-other' },
    })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({ sessionId: 'pod:thr-1', sandbox: null, pod: 'thr-1' })
  })

  it('authenticates a pod token on a podReachable route', async () => {
    const reply = await post({ procedure: 'podOpen', headers: as(POD_TOKEN) })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({ sessionId: 'pod:thr-1', sandbox: null, pod: 'thr-1' })
  })

  it('answers 403 for a sandbox token on a threadless route without sandboxReachable', async () => {
    const reply = await post({ procedure: 'threadless', headers: as(SANDBOX_TOKEN) })

    expect(reply.status).toBe(403)
  })

  it('answers 403 for a sandbox token on a pod-only threadless route', async () => {
    const reply = await post({ procedure: 'podOpen', headers: as(SANDBOX_TOKEN) })

    expect(reply.status).toBe(403)
  })

  it('authenticates a sandbox token on a sandboxReachable threadless route', async () => {
    const reply = await post({ procedure: 'sandboxOpen', headers: as(SANDBOX_TOKEN) })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({
      sessionId: 'sandbox:sbx-1',
      sandbox: 'sbx-1',
      pod: null,
    })
  })

  it('lets a sandbox token reach its own thread and a child thread', async () => {
    for (const threadId of ['thr-1', 'thr-child']) {
      const reply = await post({
        procedure: 'forThread',
        headers: as(SANDBOX_TOKEN),
        body: { threadId },
      })
      expect(reply.status).toBe(200)
    }
    expect(assertThreadInFamily).toHaveBeenCalledWith({
      sandboxThreadId: 'thr-1',
      threadId: 'thr-child',
    })
  })

  it('refuses a sandbox token naming a thread outside its family', async () => {
    const reply = await post({
      procedure: 'forThread',
      headers: as(SANDBOX_TOKEN),
      body: { threadId: 'thr-other' },
    })

    expect(reply.status).toBe(401)
  })

  it('does not consult the family for a session on a threaded route', async () => {
    assertThreadInFamily.mockClear()

    const reply = await post({
      procedure: 'forThread',
      headers: { cookie: 'ok' },
      body: { threadId: 'thr-other' },
    })

    expect(reply.status).toBe(200)
    expect(assertThreadInFamily).not.toHaveBeenCalled()
  })
})
