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
import { GithubConfig } from '@dltech/atlas-github'
import { GithubDeviceClient } from '@dltech/atlas-github'
import type { FetchFn } from '@dltech/atlas-github'
import { GithubRedirectService } from './github-redirect.service'
import { GithubRouter } from './github.router'
import { GithubService } from '@dltech/atlas-github'

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
        {
          provide: GithubRedirectService,
          useValue: {
            begin: async ({ userId }: { userId: string }) => ({
              url: `https://api.byatlas.io/return/start/${userId}`,
            }),
          },
        },
        SessionMiddleware,
        {
          provide: GithubService,
          inject: [SecretCipherService, GithubConfig, GithubDeviceClient],
          useFactory: (
            cipher: SecretCipherService,
            config: GithubConfig,
            client: GithubDeviceClient,
          ) => new GithubService(cipher, config, client),
        },
        { provide: GithubConfig, useValue: new GithubConfig({ clientId: 'gh-client-id' }) },
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
            verify: async (request: { headers: { authorization?: string } }) =>
              request.headers.authorization === 'Bearer session-a'
                ? {
                    userId: 'user-a',
                    sessionId: 'session-a',
                    email: 'a@example.com',
                  }
                : null,
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('begins a redirect for the authenticated user only', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/github.beginRedirect')
      .set(as('session-a'))
      .send({})
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      result: { data: { url: 'https://api.byatlas.io/return/start/user-a' } },
    })
    const anonymous = await request(app.getHttpServer())
      .post('/v1/trpc/github.beginRedirect')
      .send({})
    expect(anonymous.status).toBe(401)
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
