import type { ExecutionContext, INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../src/_core/config/env/env.service'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { GithubDeviceClient } from '../src/api/github/github-device-client'
import type { FetchFn } from '../src/api/github/github-device-client'
import { GithubController } from '../src/api/github/github.controller'
import { GithubService } from '../src/api/github/github.service'

vi.mock('../src/db', () => ({ db: {} }))

describe('GithubController validation (in-process)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const pendingFetch: FetchFn = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    })

    const module = await Test.createTestingModule({
      controllers: [GithubController],
      providers: [
        GithubService,
        {
          provide: GithubDeviceClient,
          useValue: new GithubDeviceClient({ fetchFn: pendingFetch }),
        },
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(
            new EnvService({
              SECRETS_ENCRYPTION_KEY:
                'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            }),
          ),
        },
        { provide: EnvService, useValue: new EnvService({ GITHUB_CLIENT_ID: 'gh-client-id' }) },
      ],
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

  it('accepts a well-formed poll body', async () => {
    const response = await request(app.getHttpServer())
      .post('/github/connect/poll')
      .send({ deviceCode: 'dc-1' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ status: 'pending' })
  })

  it('rejects an unknown property', async () => {
    await request(app.getHttpServer())
      .post('/github/connect/poll')
      .send({ deviceCode: 'dc-1', bogus: true })
      .expect(400)
  })

  it('rejects a missing deviceCode', async () => {
    await request(app.getHttpServer()).post('/github/connect/poll').send({}).expect(400)
  })
})
