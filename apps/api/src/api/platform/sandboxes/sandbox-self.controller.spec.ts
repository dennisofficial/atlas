import { UnauthorizedException, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedUsers } from '../../../../test/session-seed'
import { SandboxSelfController } from './sandbox-self.controller'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import { VercelSandboxClient } from './vercel-sandbox.client'

const SANDBOX_TOKEN = 'sandbox-token'
const POD_TOKEN = 'pod-token'

const vercel = {
  exposePort: vi.fn(async (_args: { threadId: string; name: string; port: number }) => 'https://atlas-5173.vercel.run'),
  stopSession: vi.fn(async (_args: { threadId: string; name: string; sessionId?: string | undefined }) => undefined),
}

const as = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` })

describe('SandboxSelfController', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SandboxSelfController],
      providers: [
        SandboxTokenGuard,
        { provide: VercelSandboxClient, useValue: vercel },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(query: { token: string }) {
              if (query.token === SANDBOX_TOKEN) {
                return { kind: ETokenPrincipalKind.Sandbox, id: 'sbx-1', threadId: 'thr-1', userId: 'usr-1' }
              }
              if (query.token === POD_TOKEN) {
                return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'usr-1' }
              }
              throw new UnauthorizedException()
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
    vercel.exposePort.mockClear()
    vercel.stopSession.mockClear()
  })

  it('lets a sandbox token expose a port on its own sandbox', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 5173 })

    expect(reply.status).toBe(201)
    expect(reply.body).toEqual({ url: 'https://atlas-5173.vercel.run' })
    expect(vercel.exposePort).toHaveBeenCalledWith({ threadId: 'thr-1', name: 'atlas-thread-1', port: 5173 })
  })

  it('rejects a port outside the valid range', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 70_000 })

    expect(reply.status).toBe(400)
    expect(vercel.exposePort).not.toHaveBeenCalled()
  })

  it('stops the live session the token names, answering 204', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/stop')
      .set(as(SANDBOX_TOKEN))
      .send({ sessionId: 'ses_live' })

    expect(reply.status).toBe(204)
    expect(vercel.stopSession).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: 'ses_live',
    })
  })

  it('stops with no body at all', async () => {
    const reply = await request(app.getHttpServer()).post('/v1/sandboxes/self/stop').set(as(SANDBOX_TOKEN))

    expect(reply.status).toBe(204)
    expect(vercel.stopSession).toHaveBeenCalledWith({ threadId: 'thr-1', name: 'atlas-thread-1', sessionId: undefined })
  })

  it('answers 404 when the token names a thread with no sandbox row', async () => {
    await db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).delete()

    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 5173 })

    expect(reply.status).toBe(404)
  })

  it('answers 401 with no token, an unknown token, or a pod token', async () => {
    for (const path of ['ports', 'stop']) {
      const bare = await request(app.getHttpServer()).post(`/v1/sandboxes/self/${path}`).send({ port: 5173 })
      const unknown = await request(app.getHttpServer())
        .post(`/v1/sandboxes/self/${path}`)
        .set(as('session-a'))
        .send({ port: 5173 })
      const pod = await request(app.getHttpServer())
        .post(`/v1/sandboxes/self/${path}`)
        .set(as(POD_TOKEN))
        .send({ port: 5173 })
      expect([bare.status, unknown.status, pod.status]).toEqual([401, 401, 401])
    }
    expect(vercel.exposePort).not.toHaveBeenCalled()
    expect(vercel.stopSession).not.toHaveBeenCalled()
  })
})
