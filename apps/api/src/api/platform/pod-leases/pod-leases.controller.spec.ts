import type { INestApplication } from '@nestjs/common'
import { ConflictException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { PodLeasesController } from './pod-leases.controller'
import { PodLeasesService } from './pod-leases.service'

describe('PodLeasesController', () => {
  let app: INestApplication
  const leases = { register: vi.fn(), release: vi.fn() }

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })

  beforeEach(async () => {
    leases.register.mockReset().mockResolvedValue(undefined)
    leases.release.mockReset().mockResolvedValue(undefined)
    const module = await Test.createTestingModule({
      controllers: [PodLeasesController],
      providers: [
        SessionAuthGuard,
        { provide: PodLeasesService, useValue: leases },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer session-a') return null
              return { userId: 'user-a', sessionId: 'ses', email: '', activeOrganizationId: null }
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

  afterEach(() => app.close())

  it('rejects an unauthenticated caller on both routes', async () => {
    await http().put('/v1/pod-leases/brn_1').send({ token: 'x' }).expect(401)
    await http().delete('/v1/pod-leases/brn_1').expect(401)
    expect(leases.register).not.toHaveBeenCalled()
    expect(leases.release).not.toHaveBeenCalled()
  })

  it('registers the lease for the session user and answers 204', async () => {
    const response = await http().put('/v1/pod-leases/brn_1').set(as('session-a')).send({ token: 'raw' }).expect(204)

    expect(response.text).toBe('')
    expect(leases.register).toHaveBeenCalledWith({ userId: 'user-a', threadId: 'brn_1', token: 'raw' })
  })

  it('validates the body', async () => {
    const put = (body: object) => http().put('/v1/pod-leases/brn_1').set(as('session-a')).send(body)

    await put({}).expect(400)
    await put({ token: '' }).expect(400)
    await put({ token: 5 }).expect(400)
    await put({ token: 'x'.repeat(513) }).expect(400)
    await put({ token: 'x', extra: 1 }).expect(400)
    await put({ token: 'x'.repeat(512) }).expect(204)
    expect(leases.register).toHaveBeenCalledTimes(1)
  })

  it('surfaces a foreign token hash as 409', async () => {
    leases.register.mockRejectedValue(new ConflictException('taken'))

    await http().put('/v1/pod-leases/brn_1').set(as('session-a')).send({ token: 'raw' }).expect(409)
  })

  it('releases for the session user and answers 204', async () => {
    await http().delete('/v1/pod-leases/brn_1').set(as('session-a')).expect(204)

    expect(leases.release).toHaveBeenCalledWith({ userId: 'user-a', threadId: 'brn_1' })
  })
})
