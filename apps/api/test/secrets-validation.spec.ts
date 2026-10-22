import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../src/api/platform/sessions/session-or-sandbox.guard'
import { SecretsController } from '../src/api/cloud/secrets/secrets.controller'
import { SecretsService } from '../src/api/cloud/secrets/secrets.service'

describe('SecretsController validation (in-process)', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SecretsController],
      providers: [
        SecretsService,
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(
            new EnvService({
              SECRETS_ENCRYPTION_KEY:
                'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            }),
          ),
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionOrSandboxGuard)
      .useValue({ canActivate: () => true })
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

  it('accepts a well-formed secret body', async () => {
    const response = await request(app.getHttpServer())
      .put('/secrets/web.searchKey')
      .send({ value: 'sk-search-1' })

    expect(response.status).not.toBe(400)
  })

  it('rejects an unknown property', async () => {
    await request(app.getHttpServer())
      .put('/secrets/web.searchKey')
      .send({ value: 'sk-search-1', bogus: true })
      .expect(400)
  })

  it('rejects a missing value', async () => {
    await request(app.getHttpServer()).put('/secrets/web.searchKey').send({}).expect(400)
  })
})
