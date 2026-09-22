import type { ExecutionContext, INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { SandboxTokenGuard } from '../src/api/platform/sandboxes/sandbox-token.guard'
import { SandboxesController } from '../src/api/platform/sandboxes/sandboxes.controller'
import { SandboxesService } from '../src/api/platform/sandboxes/sandboxes.service'
import { SandboxWorkspaceController } from '../src/api/platform/sandboxes/workspace.controller'

vi.mock('../src/db', () => ({ db: {} }))

const SANDBOX_TOKEN = 'sandbox-session-token'
const THREAD = 'brn_thread_1'

const SPEC = {
  remoteUrl: 'https://github.com/dennisofficial/atlas.git',
  branch: 'dennis/container-cloud',
  commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
  patch: 'diff --git a/file.ts b/file.ts\n+work in progress\n',
}

const sandboxes = {
  attach: vi.fn(async () => ({
    threadId: THREAD,
    name: 'atlas-thread-abc',
    region: 'iad1',
    state: 'running',
    lastActivityAt: '2026-09-16T00:00:00.000Z',
    url: 'https://atlas-3000.vercel.run',
    token: SANDBOX_TOKEN,
  })),
  workspace: vi.fn(async () => ({ ...SPEC, githubToken: 'gho_user-token' })),
  verifySessionToken: vi.fn(async (args: { threadId: string; token: string }) => {
    if (args.token !== SANDBOX_TOKEN) throw new UnauthorizedException('nope')
    return { threadId: args.threadId, userId: 'user-a' }
  }),
}

describe('sandbox workspace endpoint', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SandboxesController, SandboxWorkspaceController],
      providers: [SandboxTokenGuard, { provide: SandboxesService, useValue: sandboxes }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<AuthenticatedRequest>().auth = {
            userId: 'user-a',
            sessionId: 'session-a',
            email: 'a@example.com',
            activeOrganizationId: null,
          }
          return true
        },
      })
      .compile()

    app = module.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    sandboxes.attach.mockClear()
    sandboxes.workspace.mockClear()
  })

  it('carries the workspace spec on the create body', async () => {
    const response = await request(app.getHttpServer())
      .post('/sandboxes')
      .send({ threadId: THREAD, workspace: SPEC })

    expect(response.status).toBe(201)
    expect(sandboxes.attach).toHaveBeenCalledWith({
      userId: 'user-a',
      threadId: THREAD,
      workspace: SPEC,
    })
  })

  it('creates without a workspace for a session that has no repo', async () => {
    await request(app.getHttpServer()).post('/sandboxes').send({ threadId: THREAD }).expect(201)

    expect(sandboxes.attach).toHaveBeenCalledWith({
      userId: 'user-a',
      threadId: THREAD,
      workspace: undefined,
    })
  })

  it('rejects a workspace missing its patch', async () => {
    await request(app.getHttpServer())
      .post('/sandboxes')
      .send({ threadId: THREAD, workspace: { remoteUrl: null, branch: null, commit: null } })
      .expect(400)
  })

  it('answers the spec to the sandbox session token', async () => {
    const response = await request(app.getHttpServer())
      .get(`/sandboxes/${THREAD}/workspace`)
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ...SPEC, githubToken: 'gho_user-token' })
  })

  it('refuses a user session, and anything that is not the sandbox token', async () => {
    await request(app.getHttpServer()).get(`/sandboxes/${THREAD}/workspace`).expect(401)
    await request(app.getHttpServer())
      .get(`/sandboxes/${THREAD}/workspace`)
      .set('cookie', 'better-auth.session_token=a-user-session')
      .expect(401)
    await request(app.getHttpServer())
      .get(`/sandboxes/${THREAD}/workspace`)
      .set('authorization', 'Bearer some-other-token')
      .expect(401)

    expect(sandboxes.workspace).not.toHaveBeenCalled()
  })
})
