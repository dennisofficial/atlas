import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../src/_core/config/env/env.service'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { SessionMiddleware } from '../src/_module/session/session.middleware'
import { as, createMiddlewareApp } from '../src/_module/trpc/trpc-middleware.fixture'
import { AccountsRouter } from '../src/api/platform/accounts/accounts.router'
import { AccountsService } from '../src/api/platform/accounts/accounts.service'
import { seedUsers } from './session-seed'

const validBody = {
  provider: 'anthropic',
  label: 'work',
  origin: 'login',
  secret: { kind: 'api-key', apiKey: 'sk-ant-test' },
}

describe('AccountsRouter validation (in-process)', () => {
  useTestDatabase()
  let app: INestApplication
  const create = (body: unknown) =>
    request(app.getHttpServer())
      .post('/v1/trpc/accounts.create')
      .set(as('good'))
      .send(body as object)

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: 100_000,
      providers: [
        AccountsRouter,
        AccountsService,
        SessionMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer good') return null
              return { userId: 'user-a', sessionId: 's', email: '' }
            },
          },
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
      ],
    })
  })

  beforeEach(async () => {
    await seedUsers('user-a')
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts a well-formed account body', async () => {
    const response = await create(validBody)

    expect(response.status).toBe(200)
    expect(response.body.result.data).toMatchObject({ provider: 'anthropic', label: 'work' })
  })

  it('rejects an unknown property', async () => {
    const response = await create({ ...validBody, bogus: true })

    expect(response.status).toBe(400)
  })

  it('rejects an unknown property inside the secret', async () => {
    const response = await create({
      ...validBody,
      secret: { kind: 'api-key', apiKey: 'sk-ant-test', bogus: true },
    })

    expect(response.status).toBe(400)
  })

  it('rejects a bad provider value', async () => {
    const response = await create({ ...validBody, provider: 'not-a-provider' })

    expect(response.status).toBe(400)
  })

  it('rejects an empty label and a bad origin', async () => {
    expect((await create({ ...validBody, label: '' })).status).toBe(400)
    expect((await create({ ...validBody, origin: 'elsewhere' })).status).toBe(400)
  })

  it('has no access-token minting procedure (the broker is gone)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/trpc/accounts.accessToken')
      .set(as('good'))
      .send({ accountId: 'acc_1' })

    expect(response.status).toBe(404)
  })

  it('has no sandbox broker procedures', async () => {
    const server = app.getHttpServer()

    const accounts = await request(server).get('/v1/trpc/sandboxBroker.accounts').set(as('good'))
    const accessToken = await request(server)
      .post('/v1/trpc/sandboxBroker.accessToken')
      .set(as('good'))
      .send({ provider: 'anthropic' })
    const secrets = await request(server)
      .post('/v1/trpc/sandboxBroker.secrets')
      .set(as('good'))
      .send({ names: ['search.brave'] })

    expect(accounts.status).toBe(404)
    expect(accessToken.status).toBe(404)
    expect(secrets.status).toBe(404)
  })
})
