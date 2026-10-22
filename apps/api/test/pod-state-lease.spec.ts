import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from './session-seed'
import { EnvService } from '../src/_core/config/env/env.service'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { SettingsController } from '../src/api/cloud/settings/settings.controller'
import { SettingsService } from '../src/api/cloud/settings/settings.service'
import { SecretsController } from '../src/api/cloud/secrets/secrets.controller'
import { SecretsService } from '../src/api/cloud/secrets/secrets.service'
import { SandboxesService } from '../src/api/platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../src/api/platform/sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../src/api/platform/sessions/session-or-sandbox.guard'
import { AccountLeaseController } from '../src/api/platform/accounts/account-lease.controller'
import { AccountsController } from '../src/api/platform/accounts/accounts.controller'
import { AccountsService } from '../src/api/platform/accounts/accounts.service'
import type { AccountSecret } from '../src/api/platform/accounts/accounts.types'
import { EAuthKind } from '../src/api/platform/accounts/accounts.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-b': { threadId: 'thread-pod-b', userId: 'user-b' },
}
const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

type AccountSeed = { id: string; userId: string; secret: AccountSecret; createdAt: string }

const countWrites = async (): Promise<{ settings: number; secrets: number }> => ({
  settings: (await db.orm.public.UserSetting.all()).length,
  secrets: (await db.orm.public.UserSecret.all()).length,
})

describe('account lease and pod-reachable settings and secrets', () => {
  useTestDatabase()
  let app: INestApplication
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })

  const seedAccount = (args: AccountSeed) =>
    db.orm.public.AgentAccount.create({
      id: args.id,
      userId: args.userId,
      provider: args.secret.kind === EAuthKind.ApiKey ? 'openrouter' : 'anthropic',
      kind: args.secret.kind,
      origin: 'login',
      label: args.id,
      status: 'active',
      sealedSecret: cipher.encrypt(JSON.stringify(args.secret)),
      createdAt: new Date(args.createdAt),
      updatedAt: new Date(args.createdAt),
    })

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b')
    await seedAccount({
      id: 'acc-oauth-a',
      userId: 'user-a',
      createdAt: '2026-10-02T00:00:00.000Z',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
          expiresAt: '2026-10-20T00:00:00.000Z',
        },
        authority: { url: 'https://api.example.test', connectionId: 'conn-a' },
      },
    })
    await seedAccount({
      id: 'acc-key-a',
      userId: 'user-a',
      createdAt: '2026-10-01T00:00:00.000Z',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-user-a' },
    })
    await seedAccount({
      id: 'acc-key-b',
      userId: 'user-b',
      createdAt: '2026-10-01T00:00:00.000Z',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-user-b' },
    })
    await db.orm.public.ActiveAccount.createAndCount([
      { userId: 'user-a', provider: 'openrouter', accountId: 'acc-key-a' },
      { userId: 'user-a', provider: 'anthropic', accountId: 'acc-oauth-a' },
      { userId: 'user-b', provider: 'openrouter', accountId: 'acc-key-b' },
    ])
    const stamp = new Date('2026-10-03T00:00:00.000Z')
    for (const [userId, value] of [
      ['user-a', 'image-a'],
      ['user-b', 'image-b'],
    ] as const) {
      await db.orm.public.UserSetting.create({
        id: `set_${userId}`,
        userId,
        key: 'sandbox.image',
        value,
        createdAt: stamp,
        updatedAt: stamp,
      })
    }
    for (const [userId, value] of [
      ['user-a', 'vercel-a'],
      ['user-b', 'vercel-b'],
    ] as const) {
      await db.orm.public.UserSecret.create({
        id: `sec_${userId}`,
        userId,
        name: 'VERCEL_TOKEN',
        sealedValue: cipher.encrypt(JSON.stringify(value)),
        createdAt: stamp,
        updatedAt: stamp,
      })
    }

    const module = await Test.createTestingModule({
      controllers: [
        AccountsController,
        AccountLeaseController,
        SettingsController,
        SecretsController,
      ],
      providers: [
        AccountsService,
        SettingsService,
        SecretsService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        { provide: SecretCipherService, useValue: cipher },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterEach(() => app.close())

  it("leases the pod owner's accounts with the api key, no refresh token, and the active pointers", async () => {
    const lease = await http().get('/v1/account-lease').set(as('pod-token-a')).expect(200)

    expect(lease.headers['cache-control']).toBe('no-store')
    expect(lease.body.accounts.map((account: { id: string }) => account.id)).toEqual([
      'acc-key-a',
      'acc-oauth-a',
    ])
    expect(lease.body.accounts[0]).toMatchObject({
      id: 'acc-key-a',
      provider: 'openrouter',
      secret: { kind: 'api-key', apiKey: 'sk-or-user-a' },
    })
    expect(lease.body.accounts[1].secret).toEqual({
      kind: 'oauth',
      tokens: { accessToken: 'access-a', refreshToken: '', expiresAt: '2026-10-20T00:00:00.000Z' },
      authority: { url: 'https://api.example.test', connectionId: 'conn-a' },
    })
    expect(JSON.stringify(lease.body)).not.toContain('refresh-a')
    expect(lease.body.active).toHaveLength(2)
    expect(lease.body.active).toEqual(
      expect.arrayContaining([
        { provider: 'openrouter', accountId: 'acc-key-a' },
        { provider: 'anthropic', accountId: 'acc-oauth-a' },
      ]),
    )
  })

  it('does not strip the stored refresh token when leasing', async () => {
    await http().get('/v1/account-lease').set(as('pod-token-a')).expect(200)

    const stored = await db.orm.public.AgentAccount.where({ id: 'acc-oauth-a' }).first()
    expect(JSON.parse(cipher.decrypt(stored?.sealedSecret ?? '')).tokens.refreshToken).toBe(
      'refresh-a',
    )
  })

  it("gives another user's pod only its own rows", async () => {
    await db.orm.public.ActiveAccount.where({ userId: 'user-b' }).deleteAndCount()
    await db.orm.public.AgentAccount.where({ userId: 'user-b' }).deleteAndCount()

    const lease = await http().get('/v1/account-lease').set(as('pod-token-b')).expect(200)

    expect(lease.body).toEqual({ accounts: [], active: [] })
  })

  it("never includes another user's rows in a lease", async () => {
    const lease = await http().get('/v1/account-lease').set(as('pod-token-b')).expect(200)

    expect(lease.body.accounts.map((account: { id: string }) => account.id)).toEqual(['acc-key-b'])
    expect(JSON.stringify(lease.body)).not.toContain('user-a')
  })

  it('serves a session the same lease', async () => {
    const lease = await http().get('/v1/account-lease').set(as('session-a')).expect(200)

    expect(lease.body.accounts).toHaveLength(2)
  })

  it("reads the pod owner's settings and secrets only", async () => {
    const settings = await http().get('/v1/settings').set(as('pod-token-a')).expect(200)
    const secrets = await http().get('/v1/secrets').set(as('pod-token-a')).expect(200)

    expect(settings.headers['cache-control']).toBe('no-store')
    expect(secrets.headers['cache-control']).toBe('no-store')
    expect(settings.body.settings).toEqual([
      { key: 'sandbox.image', value: 'image-a', updatedAt: '2026-10-03T00:00:00.000Z' },
    ])
    expect(secrets.body.secrets).toEqual([
      { name: 'VERCEL_TOKEN', value: 'vercel-a', updatedAt: '2026-10-03T00:00:00.000Z' },
    ])
  })

  it('refuses a pod bearer on the account list and on settings and secrets writes', async () => {
    const pod = as('pod-token-a')
    const before = await countWrites()

    await http().get('/v1/accounts').set(pod).expect(401)
    await http().put('/v1/secrets/NAME').set(pod).send({ value: 'x' }).expect(401)
    await http().put('/v1/settings/sandbox.image').set(pod).send({ value: 'x' }).expect(401)
    await http().delete('/v1/secrets/NAME').set(pod).expect(401)
    await http().delete('/v1/settings/sandbox.image').set(pod).expect(401)
    expect(await countWrites()).toEqual(before)
  })

  it('still lists settings and writes secrets for a session', async () => {
    const settings = await http().get('/v1/settings').set(as('session-a')).expect(200)
    await http().put('/v1/secrets/NAME').set(as('session-a')).send({ value: 'x' }).expect(204)

    expect(settings.body.settings).toHaveLength(1)
    expect(
      await db.orm.public.UserSecret.where({ userId: 'user-a', name: 'NAME' }).first(),
    ).not.toBeNull()
    expect(await db.orm.public.UserSetting.all()).toHaveLength(2)
  })

  it('answers 401 to a missing bearer', async () => {
    await http().get('/v1/account-lease').expect(401)
    await http().get('/v1/settings').expect(401)
    await http().get('/v1/secrets').expect(401)
  })
})
