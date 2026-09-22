import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import type { SessionVerifier } from '../src/_core/ports/session-verifier'
import { contextArchiveRawParser } from '../src/api/cloud/context-archive/context-archive-http'
import { SandboxesService } from '../src/api/platform/sandboxes/sandboxes.service'
import { SessionOrSandboxGuard } from '../src/api/platform/sessions/session-or-sandbox.guard'
import { UserContextController } from '../src/api/cloud/user-context/user-context.controller'
import { UserContextService } from '../src/api/cloud/user-context/user-context.service'

const USER_SESSION = 'a-user-session'
const ARCHIVE_LIMIT_BYTES = 32

const userContext = {
  getMemory: vi.fn(async (): Promise<string | null> => null),
  putMemory: vi.fn(async () => undefined),
  getMemoryArchive: vi.fn(async (): Promise<Buffer | null> => null),
  putMemoryArchive: vi.fn(async () => undefined),
}

const verifier: SessionVerifier = {
  verify: vi.fn(async (req: { headers: { cookie?: string } }) => {
    if (req.headers.cookie?.includes(USER_SESSION) !== true) return null
    return { userId: 'user-a', sessionId: 'session-a', email: 'a@example.com', activeOrganizationId: null }
  }),
}

const sandboxes = {
  verifyTokenPrincipal: vi.fn(async () => {
    throw new UnauthorizedException('a valid sandbox session token is required')
  }),
}

describe('user-context memory endpoints', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserContextController],
      providers: [
        { provide: UserContextService, useValue: userContext },
        { provide: SESSION_VERIFIER, useValue: verifier },
        { provide: SandboxesService, useValue: sandboxes },
        Reflector,
        SessionOrSandboxGuard,
      ],
    }).compile()

    app = module.createNestApplication()
    app.use('/user-context/memory', contextArchiveRawParser({ limitBytes: ARCHIVE_LIMIT_BYTES }))
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
    userContext.getMemory.mockClear()
    userContext.putMemory.mockClear()
    userContext.getMemoryArchive.mockClear()
    userContext.putMemoryArchive.mockClear()
  })

  it('keeps the legacy JSON GET working without an Accept header', async () => {
    userContext.getMemory.mockResolvedValueOnce('{"a":1}')

    const response = await request(app.getHttpServer())
      .get('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ bundle: '{"a":1}' })
    expect(userContext.getMemoryArchive).not.toHaveBeenCalled()
  })

  it('keeps the legacy JSON PUT working, storing through the bundle path', async () => {
    await request(app.getHttpServer())
      .put('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)
      .send({ bundle: '{"a":1}' })
      .expect(204)

    expect(userContext.putMemory).toHaveBeenCalledWith({ userId: 'user-a', bundle: '{"a":1}' })
    expect(userContext.putMemoryArchive).not.toHaveBeenCalled()
  })

  it('answers a gzip archive when Accept asks for one', async () => {
    userContext.getMemoryArchive.mockResolvedValueOnce(Buffer.from('archive bytes'))

    const response = await request(app.getHttpServer())
      .get('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)
      .set('Accept', 'application/gzip')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/gzip')
    expect(response.body).toEqual(Buffer.from('archive bytes'))
    expect(userContext.getMemory).not.toHaveBeenCalled()
  })

  it('404s the gzip GET so the caller falls back to the legacy JSON GET', async () => {
    await request(app.getHttpServer())
      .get('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)
      .set('Accept', 'application/gzip')
      .expect(404)
  })

  it('stores a gzip archive PUT without touching the legacy bundle path', async () => {
    await request(app.getHttpServer())
      .put('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)
      .set('Content-Type', 'application/gzip')
      .send(Buffer.from('gzip bytes'))
      .expect(204)

    expect(userContext.putMemoryArchive).toHaveBeenCalledWith({
      userId: 'user-a',
      archive: Buffer.from('gzip bytes'),
    })
    expect(userContext.putMemory).not.toHaveBeenCalled()
  })

  it('rejects a gzip PUT over the wire-level limit with 413', async () => {
    await request(app.getHttpServer())
      .put('/user-context/memory')
      .set('cookie', `better-auth.session_token=${USER_SESSION}`)
      .set('Content-Type', 'application/gzip')
      .send(Buffer.alloc(ARCHIVE_LIMIT_BYTES + 1, 1))
      .expect(413)

    expect(userContext.putMemoryArchive).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request on both routes', async () => {
    await request(app.getHttpServer()).get('/user-context/memory').expect(401)
    await request(app.getHttpServer()).put('/user-context/memory').send({ bundle: '{}' }).expect(401)
  })
})
