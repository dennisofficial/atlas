import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { sharedSigningKeyDb } = await import('../../../../test/fake-signing-key-db.js')
  return { db: sharedSigningKeyDb.db as unknown as PrismaClient }
})

import { sharedSigningKeyDb as fake } from '../../../../test/fake-signing-key-db.js'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { GithubDeviceClient } from '../github/github-device-client'
import { GithubService } from '../github/github.service'
import { GithubSigningKeysClient } from './github-signing-keys.client'
import { generateKey } from './ssh-key.fixtures'
import { createFakeGithub } from './ssh-signing-key.fakes'
import { SshSigningKeyController } from './ssh-signing-key.controller'
import { SshSigningKeyService } from './ssh-signing-key.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-c': { threadId: 'thread-pod-c', userId: 'user-c' },
}
const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

describe('ssh signing key HTTP surface', () => {
  let app: INestApplication
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const github = createFakeGithub()
  const key = generateKey({ type: 'ed25519' })
  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })

  beforeEach(async () => {
    fake.reset()
    github.reset()
    for (const userId of ['user-a', 'user-b', 'user-c']) {
      fake.connections.push({
        userId,
        login: 'octocat',
        scopes: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        sealedToken: cipher.encrypt('gho_token'),
      })
    }
    const module = await Test.createTestingModule({
      controllers: [SshSigningKeyController],
      providers: [
        SshSigningKeyService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        { provide: SecretCipherService, useValue: cipher },
        { provide: GithubSigningKeysClient, useValue: new GithubSigningKeysClient({ fetchFn: github.fetchFn }) },
        {
          provide: GithubService,
          useFactory: () => new GithubService(cipher, new EnvService({}), new GithubDeviceClient({})),
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
              const pod = POD_TOKENS[args.token]
              if (pod === undefined) throw new UnauthorizedException()
              return { kind: ETokenPrincipalKind.Pod, ...pod }
            },
            async assertThreadInFamily() {
              throw new Error('a pod principal must never reach the thread-family check')
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
    await http().post('/v1/ssh-signing-key').set(as('session-a')).send({ privateKey: key.privateKey }).expect(201)
  })

  afterEach(() => app.close())

  it('leases the key to a pod bearer for its own user', async () => {
    const lease = await http().get('/v1/ssh-signing-key').set(as('pod-token-a')).expect(200)

    expect(lease.headers['cache-control']).toBe('no-store')
    expect(lease.body).toEqual({
      publicKey: key.publicLine,
      privateKey: key.privateKey,
      userName: 'octocat',
      userEmail: '4242+octocat@users.noreply.github.com',
    })
  })

  it('leases the key to a session', async () => {
    await http().get('/v1/ssh-signing-key').set(as('session-a')).expect(200)
  })

  it("answers 404 to a pod whose owner has no key, even when another user's key exists", async () => {
    await http().get('/v1/ssh-signing-key').set(as('pod-token-c')).expect(404)
    await http().get('/v1/ssh-signing-key').set(as('session-b')).expect(404)
  })

  it('refuses a pod bearer on status, register, rotate and revoke', async () => {
    const pod = as('pod-token-a')
    const body = { privateKey: key.privateKey }

    await http().get('/v1/ssh-signing-key/status').set(pod).expect(401)
    await http().post('/v1/ssh-signing-key').set(pod).send(body).expect(401)
    await http().post('/v1/ssh-signing-key/rotate').set(pod).send(body).expect(401)
    await http().delete('/v1/ssh-signing-key').set(pod).expect(401)
    expect(fake.keys).toHaveLength(1)
  })

  it('serves status, rotate and revoke to the owning session', async () => {
    const next = generateKey({ type: 'ed25519' })

    const status = await http().get('/v1/ssh-signing-key/status').set(as('session-a')).expect(200)
    expect(status.body).toMatchObject({ state: 'registered', publicKey: key.publicLine })
    const rotated = await http()
      .post('/v1/ssh-signing-key/rotate')
      .set(as('session-a'))
      .send({ privateKey: next.privateKey })
      .expect(200)
    expect(rotated.body).toMatchObject({ publicKey: next.publicLine })
    await http().delete('/v1/ssh-signing-key').set(as('session-a')).expect(204)
    await http().get('/v1/ssh-signing-key/status').set(as('session-a')).expect(200, { state: 'absent' })
  })

  it('validates the body', async () => {
    await http().post('/v1/ssh-signing-key').set(as('session-b')).send({}).expect(400)
    await http().post('/v1/ssh-signing-key').set(as('session-b')).send({ privateKey: 'x'.repeat(9000) }).expect(400)
    await http().post('/v1/ssh-signing-key').set(as('session-b')).send({ privateKey: 'garbage' }).expect(400)
  })

  it('requires a bearer', async () => {
    await http().get('/v1/ssh-signing-key').expect(401)
  })
})
