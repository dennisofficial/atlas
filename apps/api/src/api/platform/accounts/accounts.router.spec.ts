import { EAccountStatus } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { AccountsRouter } from './accounts.router'
import { AccountsService } from './accounts.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const USERS: Record<string, string> = { 'token-a': 'user-a', 'token-b': 'user-b' }
const draft = {
  provider: 'anthropic',
  label: 'work',
  origin: 'login',
  secret: { kind: 'api-key', apiKey: 'sk-ant-test' },
}

describe('AccountsRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const url = (procedure: string) => `/v1/trpc/accounts.${procedure}`
  const query = (procedure: string, token: string | undefined, input?: unknown) => {
    const call = request(app.getHttpServer()).get(url(procedure))
    const authed = token === undefined ? call : call.set(as(token))
    return input === undefined ? authed : authed.query({ input: JSON.stringify(input) })
  }
  const mutate = (procedure: string, token: string | undefined, body?: unknown) => {
    const call = request(app.getHttpServer()).post(url(procedure))
    const authed = token === undefined ? call : call.set(as(token))
    return body === undefined ? authed : authed.send(body as object)
  }
  const createdBy = async (token: string): Promise<string> =>
    (await mutate('create', token, draft)).body.result.data.id

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
              const userId = USERS[(req.headers.authorization ?? '').replace(/^Bearer /, '')]
              if (userId === undefined) return null
              return { userId, sessionId: 's', email: '' }
            },
          },
        },
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b')
  })

  it('answers 401 on every procedure without a session', async () => {
    expect((await query('list', undefined)).status).toBe(401)
    expect((await query('get', undefined, { accountId: 'acc_1' })).status).toBe(401)
    expect((await query('active', undefined, { provider: 'anthropic' })).status).toBe(401)
    expect((await mutate('create', undefined, draft)).status).toBe(401)
    expect((await mutate('remove', undefined, { accountId: 'acc_1' })).status).toBe(401)
    expect(await db.orm.public.AgentAccount.all()).toHaveLength(0)
  })

  it('creates an account without exposing the secret and lists it', async () => {
    const created = await mutate('create', 'token-a', { ...draft, email: 'a@b.c' })

    expect(created.status).toBe(200)
    expect(created.body.result.data).toMatchObject({
      provider: 'anthropic',
      kind: 'api-key',
      status: 'active',
      email: 'a@b.c',
    })
    expect(created.body.result.data).not.toHaveProperty('secret')
    expect(created.body.result.data).not.toHaveProperty('subscription')
    const listed = await query('list', 'token-a')
    expect(listed.body.result.data.map((account: { id: string }) => account.id)).toEqual([
      created.body.result.data.id,
    ])
    expect((await query('list', 'token-b')).body.result.data).toEqual([])
  })

  it('reads a stored account with its secret and 404s for another user', async () => {
    const id = await createdBy('token-a')

    const own = await query('get', 'token-a', { accountId: id })
    const foreign = await query('get', 'token-b', { accountId: id })

    expect(own.body.result.data.secret).toEqual({ kind: 'api-key', apiKey: 'sk-ant-test' })
    expect(foreign.status).toBe(404)
  })

  it('sets and reads the active pointer, defaulting to null', async () => {
    const first = await createdBy('token-a')
    const second = await createdBy('token-a')

    expect((await query('active', 'token-a', { provider: 'anthropic' })).body.result.data).toEqual({
      accountId: first,
    })
    const set = await mutate('setActive', 'token-a', { provider: 'anthropic', accountId: second })
    expect(set.status).toBe(200)
    expect(set.body).toEqual({ result: {} })
    expect((await query('active', 'token-a', { provider: 'anthropic' })).body.result.data).toEqual({
      accountId: second,
    })
    expect((await query('active', 'token-a', { provider: 'openai' })).body.result.data).toEqual({
      accountId: null,
    })
    expect(
      (await mutate('setActive', 'token-b', { provider: 'anthropic', accountId: second })).status,
    ).toBe(404)
  })

  it('replaces a secret and sets a status', async () => {
    const id = await createdBy('token-a')

    await mutate('setStatus', 'token-a', { accountId: id, status: EAccountStatus.Expired })
    const expired = await query('get', 'token-a', { accountId: id })
    await mutate('replaceSecret', 'token-a', {
      accountId: id,
      secret: { kind: 'api-key', apiKey: 'sk-ant-new' },
    })
    const replaced = await query('get', 'token-a', { accountId: id })

    expect(expired.body.result.data.status).toBe('expired')
    expect(replaced.body.result.data.status).toBe('active')
    expect(replaced.body.result.data.secret).toEqual({ kind: 'api-key', apiKey: 'sk-ant-new' })
  })

  it('rejects a bad status, an unknown key and an empty account id', async () => {
    const id = await createdBy('token-a')

    expect((await mutate('setStatus', 'token-a', { accountId: id, status: 'bogus' })).status).toBe(
      400,
    )
    expect((await mutate('remove', 'token-a', { accountId: id, extra: 1 })).status).toBe(400)
    expect((await mutate('remove', 'token-a', { accountId: '' })).status).toBe(400)
    expect((await mutate('replaceSecret', 'token-a', { accountId: id, secret: {} })).status).toBe(
      400,
    )
  })

  it('answers 400 from the service for a secret that does not match its kind', async () => {
    const response = await mutate('create', 'token-a', { ...draft, secret: { kind: 'oauth' } })

    expect(response.status).toBe(400)
    expect(await db.orm.public.AgentAccount.all()).toHaveLength(0)
  })

  it('removes only the caller’s account', async () => {
    const id = await createdBy('token-a')

    expect((await mutate('remove', 'token-b', { accountId: id })).status).toBe(404)
    const removed = await mutate('remove', 'token-a', { accountId: id })

    expect(removed.status).toBe(200)
    expect((await query('list', 'token-a')).body.result.data).toEqual([])
  })
})
