import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubDeviceClient } from '../github/github-device-client'
import { GithubService } from '../github/github.service'
import {
  buildSessionTrpcApp,
  dataOf,
  testCipher,
  trpcMutation,
  trpcQuery,
} from '../session-trpc-test-app'
import { GithubSigningKeysClient } from './github-signing-keys.client'
import { generateKey } from './ssh-key.fixtures'
import { createFakeGithub } from './ssh-signing-key.fakes'
import { SshSigningKeyRouter } from './ssh-signing-key.router'
import { SshSigningKeyService } from './ssh-signing-key.service'

const POD_TOKENS = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-c': { threadId: 'thread-pod-c', userId: 'user-c' },
}

describe('SshSigningKeyRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const cipher = testCipher()
  const github = createFakeGithub()
  const key = generateKey({ type: 'ed25519' })
  const query = (procedure: string, token?: string) =>
    trpcQuery({ app, path: `sshSigningKey.${procedure}`, token })
  const mutate = (procedure: string, token: string | undefined, input?: unknown) =>
    trpcMutation({ app, path: `sshSigningKey.${procedure}`, token, input })

  beforeEach(async () => {
    github.reset()
    for (const userId of ['user-a', 'user-b', 'user-c']) {
      await seedUser({ db, id: userId })
      await db.orm.public.GithubConnection.create({
        id: `ghc_${userId}`,
        userId,
        login: 'octocat',
        scopes: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        sealedToken: cipher.encrypt('gho_token'),
      })
    }
    app = await buildSessionTrpcApp({
      podTokens: POD_TOKENS,
      providers: [
        SshSigningKeyRouter,
        SshSigningKeyService,
        {
          provide: GithubSigningKeysClient,
          useValue: new GithubSigningKeysClient({ fetchFn: github.fetchFn }),
        },
        {
          provide: GithubService,
          useFactory: (secrets: SecretCipherService) =>
            new GithubService(secrets, new EnvService({}), new GithubDeviceClient({})),
          inject: [SecretCipherService],
        },
      ],
    })
    await mutate('register', 'session-a', { privateKey: key.privateKey }).expect(200)
  })

  afterEach(() => app.close())

  it('leases the key to a pod bearer for its own user', async () => {
    const lease = await query('lease', 'pod-token-a').expect(200)

    expect(lease.headers['cache-control']).toBe('no-store')
    expect(dataOf(lease.body)).toEqual({
      publicKey: key.publicLine,
      privateKey: key.privateKey,
      userName: 'octocat',
      userEmail: '4242+octocat@users.noreply.github.com',
    })
  })

  it('leases the key to a session', async () => {
    await query('lease', 'session-a').expect(200)
  })

  it("answers 404 to a pod whose owner has no key, even when another user's key exists", async () => {
    await query('lease', 'pod-token-c').expect(404)
    await query('lease', 'session-b').expect(404)
  })

  it('refuses a pod bearer on status, register, rotate and revoke', async () => {
    const pod = 'pod-token-a'
    const input = { privateKey: key.privateKey }

    await query('status', pod).expect(401)
    await mutate('register', pod, input).expect(401)
    await mutate('rotate', pod, input).expect(401)
    await mutate('revoke', pod).expect(401)
    expect(await db.orm.public.SshSigningKey.all()).toHaveLength(1)
  })

  it('serves status, rotate and revoke to the owning session', async () => {
    const next = generateKey({ type: 'ed25519' })

    const status = await query('status', 'session-a').expect(200)
    expect(status.headers['cache-control']).toBe('no-store')
    expect(dataOf(status.body)).toMatchObject({ state: 'registered', publicKey: key.publicLine })
    const rotated = await mutate('rotate', 'session-a', { privateKey: next.privateKey }).expect(200)
    expect(dataOf(rotated.body)).toMatchObject({ publicKey: next.publicLine })
    await mutate('revoke', 'session-a').expect(200)
    const absent = await query('status', 'session-a').expect(200)
    expect(dataOf(absent.body)).toEqual({ state: 'absent' })
  })

  it('validates the input', async () => {
    await mutate('register', 'session-b', {}).expect(400)
    await mutate('register', 'session-b', { privateKey: 'x'.repeat(9000) }).expect(400)
    await mutate('register', 'session-b', { privateKey: 'garbage' }).expect(400)
  })

  it('requires a bearer', async () => {
    await query('lease').expect(401)
  })
})
