import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { OauthConnectionsController } from './oauth-connections.controller'
import { FakeClock, FakeIssuer, FakeStore, grantOf } from './oauth-connections.fakes'
import { OauthConnectionsService } from './oauth-connections.service'
import { OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const START = Date.parse('2026-10-05T12:00:00.000Z')
const SANDBOX_TOKENS: Record<string, { id: string; threadId: string; userId: string }> = {
  'sandbox-token-1': { id: 'sbx-1', threadId: 'thread-1', userId: 'user-a' },
  'sandbox-token-2': { id: 'sbx-2', threadId: 'thread-2', userId: 'user-a' },
}
const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }

const bearerOf = (request: { headers: { authorization?: string } }): string =>
  (request.headers.authorization ?? '').replace(/^Bearer /i, '')

describe('OauthConnectionsController authorization', () => {
  let app: INestApplication
  let store: FakeStore

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })
  const upload = (token: string) =>
    http()
      .put('/v1/oauth-connections/conn-1')
      .set(as(token))
      .send({ provider: 'anthropic', tokens: grantOf(START) })

  beforeEach(async () => {
    store = new FakeStore()
    store.sandboxes.set('thread-1', { id: 'sbx-1', userId: 'user-a' })
    store.sandboxes.set('thread-2', { id: 'sbx-2', userId: 'user-a' })
    const module = await Test.createTestingModule({
      controllers: [OauthConnectionsController],
      providers: [
        OauthConnectionsService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        { provide: OauthConnectionStore, useValue: store },
        { provide: OauthIssuer, useValue: new FakeIssuer() },
        { provide: OauthClock, useValue: new FakeClock(START) },
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
        },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              const row = SANDBOX_TOKENS[args.token]
              if (row === undefined) throw new UnauthorizedException()
              return row
            },
            async assertThreadInFamily() {},
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

  it('rejects an unauthenticated caller on every route', async () => {
    await http().put('/v1/oauth-connections/conn-1').send({}).expect(401)
    await http().post('/v1/oauth-connections/conn-1/access-token').send({}).expect(401)
    await http().put('/v1/oauth-connections/conn-1/sandboxes/thread-1').expect(401)
    await http().delete('/v1/oauth-connections/conn-1').expect(401)
  })

  it('exposes only owned authorization metadata, not tokens or sandbox access', async () => {
    await upload('session-a').expect(200)
    const response = await http().get('/v1/oauth-connections/conn-1').set(as('session-a')).expect(200)
    expect(response.body).toEqual({ provider: 'anthropic', authorizationId: 'conn-1', generation: 0 })
    expect(response.headers['cache-control']).toBe('no-store')
    await http().get('/v1/oauth-connections/conn-1').set(as('session-b')).expect(404)
    await http().get('/v1/oauth-connections/conn-1').set(as('sandbox-token-1')).expect(401)
    await http().get('/v1/oauth-connections/conn-1').expect(401)
  })

  it('keeps upload, assignment and deletion session-only', async () => {
    await upload('session-a').expect(200)
    await upload('sandbox-token-1').expect(401)
    await http().put('/v1/oauth-connections/conn-1/sandboxes/thread-1').set(as('sandbox-token-1')).expect(401)
    await http().delete('/v1/oauth-connections/conn-1').set(as('sandbox-token-1')).expect(401)
    expect(store.rows.has('conn-1')).toBe(true)
  })

  it('refuses a malformed expiry before persisting a grant', async () => {
    await http().put('/v1/oauth-connections/conn-1').set(as('session-a'))
      .send({ provider: 'anthropic', tokens: { ...grantOf(START), expiresAt: 'not-a-date' } }).expect(400)
    expect(store.rows.has('conn-1')).toBe(false)
  })

  it('issues access-only, uncacheable answers to the owning session', async () => {
    const created = await upload('session-a').expect(200)
    expect(created.headers['cache-control']).toBe('no-store')
    const issued = await http()
      .post('/v1/oauth-connections/conn-1/access-token')
      .set(as('session-a'))
      .send({})
      .expect(200)
    expect(issued.headers['cache-control']).toBe('no-store')
    expect(JSON.stringify([created.body, issued.body])).not.toContain('refresh-0')
    expect(issued.body).toMatchObject({ accessToken: 'access-0', generation: 0 })
  })

  it('hides a connection from another user', async () => {
    await upload('session-a').expect(200)
    await upload('session-b').expect(404)
    await http().post('/v1/oauth-connections/conn-1/access-token').set(as('session-b')).send({}).expect(404)
    await http().put('/v1/oauth-connections/conn-1/sandboxes/thread-1').set(as('session-b')).expect(404)
    await http().delete('/v1/oauth-connections/conn-1').set(as('session-b')).expect(404)
  })

  it('lets only an assigned sandbox mint access tokens', async () => {
    await upload('session-a').expect(200)
    const mint = (token: string) =>
      http().post('/v1/oauth-connections/conn-1/access-token').set(as(token)).send({})

    await mint('sandbox-token-1').expect(404)
    await http().put('/v1/oauth-connections/conn-1/sandboxes/thread-1').set(as('session-a')).expect(204)
    await mint('sandbox-token-1').expect(200)
    await mint('sandbox-token-2').expect(404)
    await mint('sandbox-token-unknown').expect(401)
  })

  it('reauthorizes on the same connection for the session only and surfaces authorizationId', async () => {
    await upload('session-a').expect(200)
    const body = (to: string, from: string) => ({
      provider: 'anthropic', tokens: grantOf(START), authorizationId: to, previousAuthorizationId: from,
    })
    const put = (token: string, payload: object) =>
      http().put('/v1/oauth-connections/conn-1/reauthorize').set(as(token)).send(payload)

    await put('sandbox-token-1', body('auth-2', 'conn-1')).expect(401)
    await put('session-b', body('auth-2', 'conn-1')).expect(404)
    const done = await put('session-a', body('auth-2', 'conn-1')).expect(200)
    expect(done.headers['cache-control']).toBe('no-store')
    expect(done.body).toMatchObject({ authorizationId: 'auth-2', generation: 1 })
    await put('session-a', body('auth-2', 'conn-1')).expect(200)
    await put('session-a', body('auth-3', 'conn-1')).expect(409)
    await put('session-a', { provider: 'anthropic', tokens: grantOf(START) }).expect(400)
  })

  it('refuses to assign a sandbox that does not exist yet', async () => {
    await upload('session-a').expect(200)
    await http().put('/v1/oauth-connections/conn-1/sandboxes/thread-9').set(as('session-a')).expect(404)
  })

  it('rejects unknown body fields and unsupported providers', async () => {
    await http().put('/v1/oauth-connections/conn-1').set(as('session-a'))
      .send({ provider: 'openrouter', tokens: grantOf(START) }).expect(400)
    await http().post('/v1/oauth-connections/conn-1/access-token').set(as('session-a'))
      .send({ refreshToken: 'x' }).expect(400)
  })
})
