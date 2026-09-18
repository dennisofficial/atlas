import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { SessionOrSandboxGuard } from '../src/api/sessions/session-or-sandbox.guard'
import { AccountsController } from '../src/api/accounts/accounts.controller'
import { AccountsService } from '../src/api/accounts/accounts.service'
import { BrokerService } from '../src/api/accounts/broker.service'

vi.mock('../src/db', () => ({ db: {} }))

describe('AccountsController validation (in-process)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        AccountsService,
        BrokerService,
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

  it('accepts a well-formed account body', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .send({
        provider: 'anthropic',
        label: 'work',
        origin: 'login',
        secret: { kind: 'api-key', apiKey: 'sk-ant-test' },
      })

    expect(response.status).not.toBe(400)
  })

  it('rejects an unknown property', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .send({
        provider: 'anthropic',
        label: 'work',
        origin: 'login',
        secret: { kind: 'api-key', apiKey: 'sk-ant-test' },
        bogus: true,
      })
      .expect(400)
  })

  it('rejects a bad provider value', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .send({
        provider: 'not-a-provider',
        label: 'work',
        origin: 'login',
        secret: { kind: 'api-key', apiKey: 'sk-ant-test' },
      })
      .expect(400)
  })
})
