import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FakeClock, FakeIssuer, FakeStore, grantOf } from './oauth-connections.fakes'
import { OauthConnectionsService } from './oauth-connections.service'
import { EConnectionStatus, EOauthProvider, OauthRejectedError } from './oauth-connections.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const START = Date.parse('2026-10-05T12:00:00.000Z')
const HOUR = 3_600_000
const OWNER = 'user-a'
const CONNECTION = 'conn-1'

describe('OauthConnectionsService reauthorize', () => {
  let store: FakeStore
  let issuer: FakeIssuer
  let clock: FakeClock
  let service: OauthConnectionsService

  const login = (name: string) => ({
    provider: EOauthProvider.Anthropic,
    tokens: { ...grantOf(clock.now()), accessToken: `access-${name}`, refreshToken: `refresh-${name}` },
  })
  const reauthorize = (args: { to: string; from: string; userId?: string }) =>
    service.reauthorize({
      userId: args.userId ?? OWNER,
      connectionId: CONNECTION,
      draft: { ...login(args.to), authorizationId: args.to, previousAuthorizationId: args.from },
    })

  beforeEach(async () => {
    store = new FakeStore()
    issuer = new FakeIssuer()
    clock = new FakeClock(START)
    service = new OauthConnectionsService(
      store,
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
      issuer,
      clock,
    )
    await service.upload({ userId: OWNER, connectionId: CONNECTION, draft: login('first') })
  })

  it('replaces the grant on the same connection so an assigned sandbox gets the new token', async () => {
    store.sandboxes.set('thread-1', { id: 'sbx-1', userId: OWNER })
    await service.assignSandbox({ userId: OWNER, connectionId: CONNECTION, threadId: 'thread-1' })

    const dto = await reauthorize({ to: 'auth-2', from: CONNECTION })

    expect(dto).toMatchObject({ accessToken: 'access-auth-2', authorizationId: 'auth-2', generation: 1 })
    const viaSandbox = await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION, sandboxId: 'sbx-1' })
    expect(viaSandbox.accessToken).toBe('access-auth-2')
    expect(JSON.stringify(dto)).not.toContain('refresh-auth-2')
  })

  it('answers a retry of the accepted reauthorization without rolling back a later rotation', async () => {
    await reauthorize({ to: 'auth-2', from: CONNECTION })
    clock.current += HOUR
    const rotated = await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })
    expect(rotated.generation).toBe(2)

    const retry = await reauthorize({ to: 'auth-2', from: CONNECTION })

    expect(retry.accessToken).toBe(rotated.accessToken)
    expect(retry.generation).toBe(2)
  })

  it('refuses a delayed reauthorization whose predecessor is no longer current', async () => {
    await reauthorize({ to: 'auth-2', from: CONNECTION })
    await reauthorize({ to: 'auth-3', from: 'auth-2' })

    await expect(reauthorize({ to: 'auth-2b', from: CONNECTION })).rejects.toBeInstanceOf(ConflictException)
    await expect(reauthorize({ to: 'auth-2', from: CONNECTION })).rejects.toBeInstanceOf(ConflictException)

    const current = await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })
    expect(current).toMatchObject({ accessToken: 'access-auth-3', authorizationId: 'auth-3' })
  })

  it('is independent of the refresh generation', async () => {
    clock.current += HOUR
    await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })
    await expect(reauthorize({ to: 'auth-2', from: CONNECTION })).resolves.toMatchObject({ generation: 2 })
  })

  it('revives an expired connection', async () => {
    clock.current += HOUR
    issuer.outcome = async () => { throw new OauthRejectedError('invalid_grant') }
    await expect(service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })).rejects.toBeInstanceOf(ConflictException)
    expect(store.rows.get(CONNECTION)?.status).toBe(EConnectionStatus.Expired)

    await reauthorize({ to: 'auth-2', from: CONNECTION })

    expect(store.rows.get(CONNECTION)?.status).toBe(EConnectionStatus.Active)
  })

  it('clears an uncertain attempt so the new grant is served', async () => {
    clock.current += HOUR - 2 * 60_000
    issuer.outcome = async () => { throw new Error('connection reset') }
    await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })
    expect(store.rows.get(CONNECTION)?.refreshAttempt).not.toBeNull()

    const dto = await reauthorize({ to: 'auth-2', from: CONNECTION })

    expect(dto.accessToken).toBe('access-auth-2')
    expect(store.rows.get(CONNECTION)?.refreshAttempt).toBeNull()
  })

  it.each([
    ['a successful', async () => ({ accessToken: 'stale-access', refreshToken: 'stale-refresh', expiresAt: new Date(START + 2 * HOUR).toISOString() })],
    ['a rejected', async () => { throw new OauthRejectedError('invalid_grant') }],
    ['a lost', async () => { throw new Error('connection reset') }],
  ])('fences an in-flight old refresh that ends in %s response', async (_label, outcome) => {
    clock.current += HOUR
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    issuer.outcome = async (args) => { await gate; return outcome().then((issued) => ({ ...issued, expiresAt: new Date(args.nowMs + HOUR).toISOString() })) }

    const inFlight = service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION })
    await new Promise((resolve) => setImmediate(resolve))
    await reauthorize({ to: 'auth-2', from: CONNECTION })
    release()
    const answer = await inFlight

    expect(answer).toMatchObject({ accessToken: 'access-auth-2', authorizationId: 'auth-2' })
    const row = store.rows.get(CONNECTION)
    expect(row).toMatchObject({ status: EConnectionStatus.Active, authorizationId: 'auth-2', refreshAttempt: null })
  })

  it('refuses another user and a mismatched provider', async () => {
    await expect(reauthorize({ to: 'auth-2', from: CONNECTION, userId: 'user-b' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.reauthorize({
        userId: OWNER,
        connectionId: CONNECTION,
        draft: { ...login('x'), provider: EOauthProvider.OpenAI, authorizationId: 'auth-2', previousAuthorizationId: CONNECTION },
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
