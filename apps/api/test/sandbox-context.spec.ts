import type { ExecutionContext, INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { contextArchiveRawParser } from '../src/api/context-archive/context-archive-http'
import { SandboxContextController } from '../src/api/sandboxes/sandbox-context.controller'
import { SandboxTokenGuard } from '../src/api/sandboxes/sandbox-token.guard'
import { SandboxesController } from '../src/api/sandboxes/sandboxes.controller'
import { SandboxesService } from '../src/api/sandboxes/sandboxes.service'

vi.mock('../src/db', () => ({ db: {} }))

const SANDBOX_TOKEN = 'sandbox-session-token'
const THREAD = 'brn_thread_1'
const ARCHIVE_LIMIT_BYTES = 32

const sandboxes = {
  putContextArchive: vi.fn(async () => undefined),
  getContextArchive: vi.fn(async (): Promise<Buffer | null> => null),
  verifySessionToken: vi.fn(async (args: { threadId: string; token: string }) => {
    if (args.token !== SANDBOX_TOKEN) throw new UnauthorizedException('nope')
    return undefined
  }),
  verifyTokenPrincipal: vi.fn(async (args: { token: string }) => {
    if (args.token !== SANDBOX_TOKEN) throw new UnauthorizedException('nope')
    return { threadId: THREAD }
  }),
}

describe('sandbox context endpoints', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SandboxContextController, SandboxesController],
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
    app.use(
      '/sandboxes/:threadId/context',
      contextArchiveRawParser({ limitBytes: ARCHIVE_LIMIT_BYTES }),
    )
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
    sandboxes.putContextArchive.mockClear()
    sandboxes.getContextArchive.mockClear()
  })

  it('stores an operator-uploaded gzip archive with a 204', async () => {
    await request(app.getHttpServer())
      .put(`/sandboxes/${THREAD}/context`)
      .set('Content-Type', 'application/gzip')
      .set('cookie', 'better-auth.session_token=a-user-session')
      .send(Buffer.from('gzip bytes'))
      .expect(204)

    expect(sandboxes.putContextArchive).toHaveBeenCalledWith({
      userId: 'user-a',
      threadId: THREAD,
      archive: Buffer.from('gzip bytes'),
    })
  })

  it('rejects a non-gzip content type with 415', async () => {
    await request(app.getHttpServer())
      .put(`/sandboxes/${THREAD}/context`)
      .set('Content-Type', 'application/json')
      .send({ oops: true })
      .expect(415)

    expect(sandboxes.putContextArchive).not.toHaveBeenCalled()
  })

  it('rejects a gzip body over the wire-level limit with 413', async () => {
    await request(app.getHttpServer())
      .put(`/sandboxes/${THREAD}/context`)
      .set('Content-Type', 'application/gzip')
      .send(Buffer.alloc(ARCHIVE_LIMIT_BYTES + 1, 1))
      .expect(413)

    expect(sandboxes.putContextArchive).not.toHaveBeenCalled()
  })

  it("answers the sandbox's own archive to its session token", async () => {
    sandboxes.getContextArchive.mockResolvedValueOnce(Buffer.from('archive bytes'))

    const response = await request(app.getHttpServer())
      .get('/sandboxes/context')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/gzip')
    expect(response.body).toEqual(Buffer.from('archive bytes'))
    expect(sandboxes.getContextArchive).toHaveBeenCalledWith({ threadId: THREAD })
  })

  it('404s the download when no archive has ever been stored', async () => {
    await request(app.getHttpServer())
      .get('/sandboxes/context')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
      .expect(404)
  })

  it('refuses the download without a valid sandbox token', async () => {
    await request(app.getHttpServer()).get('/sandboxes/context').expect(401)
    await request(app.getHttpServer())
      .get('/sandboxes/context')
      .set('authorization', 'Bearer some-other-token')
      .expect(401)

    expect(sandboxes.getContextArchive).not.toHaveBeenCalled()
  })
})
