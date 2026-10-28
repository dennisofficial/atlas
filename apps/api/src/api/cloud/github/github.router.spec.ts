import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { GithubDeviceClient } from './github-device-client'
import type { FetchFn } from './github-device-client'
import { GithubRouter } from './github.router'
import { GithubService } from './github.service'

const pendingFetch: FetchFn = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ error: 'authorization_pending' }),
})

describe('GithubRouter poll validation', () => {
  let app: INestApplication

  const poll = (body: unknown) =>
    request(app.getHttpServer())
      .post('/v1/trpc/github.pollConnect')
      .set(as('session-a'))
      .send(body as object)

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        GithubRouter,
        SessionMiddleware,
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
        {
          provide: SESSION_VERIFIER,
          useValue: {
            verify: async () => ({
              userId: 'user-a',
              sessionId: 'session-a',
              email: 'a@example.com',
            }),
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts a well-formed poll body', async () => {
    const reply = await poll({ deviceCode: 'dc-1' })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { status: 'pending' } } })
  })

  it('rejects an unknown property', async () => {
    const reply = await poll({ deviceCode: 'dc-1', bogus: true })

    expect(reply.status).toBe(400)
  })

  it('rejects a missing deviceCode', async () => {
    const reply = await poll({})

    expect(reply.status).toBe(400)
  })
})
