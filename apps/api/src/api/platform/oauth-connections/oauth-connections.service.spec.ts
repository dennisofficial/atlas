import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
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

describe('OauthConnectionsService', () => {
  let store: FakeStore
  let issuer: FakeIssuer
  let clock: FakeClock
  let cipher: SecretCipherService
  let service: OauthConnectionsService
  let sibling: OauthConnectionsService

  const build = () => new OauthConnectionsService(store, cipher, issuer, clock)
  const upload = (args: { userId?: string; lifetimeMs?: number } = {}) =>
    service.upload({
      userId: args.userId ?? OWNER,
      connectionId: CONNECTION,
      draft: { provider: EOauthProvider.Anthropic, tokens: grantOf(clock.now(), args.lifetimeMs) },
    })
  const issue = (args: { rejected?: string; via?: OauthConnectionsService } = {}) =>
    (args.via ?? service).issueAccessToken({
      userId: OWNER,
      connectionId: CONNECTION,
      ...(args.rejected === undefined ? {} : { rejectedAccessToken: args.rejected }),
    })

  beforeEach(() => {
    store = new FakeStore()
    issuer = new FakeIssuer()
    clock = new FakeClock(START)
    cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    service = build()
    sibling = build()
  })

  it('never returns a refresh token and stores the grant sealed', async () => {
    const dto = await upload()
    expect(JSON.stringify(dto)).not.toContain('refresh-0')
    expect(Object.keys(dto)).not.toContain('refreshToken')
    expect(store.rows.get(CONNECTION)?.sealedTokens).not.toContain('refresh-0')
  })

  it('answers a replayed upload with the current token instead of rolling back', async () => {
    await upload()
    clock.current += HOUR
    const successor = await issue()
    expect(successor.generation).toBe(1)

    const replay = await upload()

    expect(replay.accessToken).toBe(successor.accessToken)
    expect(replay.generation).toBe(1)
  })

  it('refuses another user without revealing the connection', async () => {
    await upload()
    await expect(upload({ userId: 'user-b' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.issueAccessToken({ userId: 'user-b', connectionId: CONNECTION }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('serves a fresh token without contacting the issuer', async () => {
    await upload()
    await issue()
    expect(issuer.calls).toHaveLength(0)
  })

  it('exchanges once for many concurrent callers across two service instances', async () => {
    await upload()
    clock.current += HOUR
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    issuer.outcome = async (args) => {
      await gate
      return { accessToken: 'access-new', refreshToken: 'refresh-new', expiresAt: new Date(args.nowMs + HOUR).toISOString() }
    }

    const callerCount = 12
    clock.onSleep = () => {
      if (clock.sleeps >= callerCount - 1) release()
    }
    const callers = Array.from({ length: callerCount }, (_, index) =>
      issue({ via: index % 2 === 0 ? service : sibling }),
    )
    const results = await Promise.all(callers)

    expect(issuer.calls).toEqual(['refresh-0'])
    expect(new Set(results.map((dto) => dto.accessToken))).toEqual(new Set(['access-new']))
    expect(store.rows.get(CONNECTION)?.generation).toBe(1)
  })

  it('refreshes inside the skew window and caps skew for short-lived tokens', async () => {
    await upload()
    clock.current += HOUR - 4 * 60_000
    await issue()
    expect(issuer.calls).toHaveLength(1)

    const short = await service.upload({
      userId: OWNER,
      connectionId: 'short',
      draft: { provider: EOauthProvider.OpenAI, tokens: grantOf(clock.now(), 60_000) },
    })
    expect(Date.parse(short.refreshAfter)).toBe(clock.now() + 54_000)
    await service.issueAccessToken({ userId: OWNER, connectionId: 'short' })
    expect(issuer.calls).toHaveLength(1)
  })

  it('answers a delayed rejection of a predecessor with the current token', async () => {
    await upload()
    clock.current += HOUR
    const successor = await issue()
    const callsBefore = issuer.calls.length

    const answer = await issue({ rejected: 'access-0' })

    expect(answer.accessToken).toBe(successor.accessToken)
    expect(issuer.calls).toHaveLength(callsBefore)
  })

  it('does not rotate for a rejected token that is not the current one', async () => {
    await upload()
    await issue({ rejected: 'unrelated-token' })
    expect(issuer.calls).toHaveLength(0)
  })

  it('rotates when the current token itself was rejected', async () => {
    await upload()
    const answer = await issue({ rejected: 'access-0' })
    expect(issuer.calls).toHaveLength(1)
    expect(answer.generation).toBe(1)
  })

  it('keeps a lost response uncertain and never retries the predecessor', async () => {
    await upload()
    clock.current += HOUR - 2 * 60_000
    issuer.outcome = async () => { throw new Error('connection reset') }

    const first = await issue()
    expect(first.accessToken).toBe('access-0')
    expect(store.rows.get(CONNECTION)?.refreshAttempt).not.toBeNull()

    const second = await issue()
    expect(second.accessToken).toBe('access-0')
    expect(issuer.calls).toHaveLength(1)
  })

  it('refuses a rejected token during an uncertain attempt and demands login once stale', async () => {
    await upload()
    clock.current += HOUR - 2 * 60_000
    issuer.outcome = async () => { throw new Error('timeout') }
    await issue()

    await expect(issue({ rejected: 'access-0' })).rejects.toBeInstanceOf(ServiceUnavailableException)
    clock.current += 120_000
    await expect(issue()).rejects.toBeInstanceOf(ConflictException)
    expect(issuer.calls).toHaveLength(1)
  })

  it('marks the connection expired on a definitive rejection', async () => {
    await upload()
    clock.current += HOUR
    issuer.outcome = async () => { throw new OauthRejectedError('invalid_grant') }

    await expect(issue()).rejects.toBeInstanceOf(ConflictException)
    expect(store.rows.get(CONNECTION)?.status).toBe(EConnectionStatus.Expired)
    await expect(issue()).rejects.toBeInstanceOf(ConflictException)
    expect(issuer.calls).toHaveLength(1)
  })

  it('keeps the old refresh token when the issuer omits a replacement', async () => {
    await upload()
    clock.current += HOUR
    issuer.outcome = async (args) => ({ accessToken: 'access-new', expiresAt: new Date(args.nowMs + HOUR).toISOString() })
    await issue()
    clock.current += HOUR
    await issue()
    expect(issuer.calls).toEqual(['refresh-0', 'refresh-0'])
  })

  it('assigns only a sandbox the user owns and gates sandbox issuance on the assignment', async () => {
    await upload()
    store.sandboxes.set('thread-1', { id: 'sbx-1', userId: OWNER })
    store.sandboxes.set('thread-2', { id: 'sbx-2', userId: 'user-b' })

    await expect(
      service.assignSandbox({ userId: OWNER, connectionId: CONNECTION, threadId: 'thread-2' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION, sandboxId: 'sbx-1' }),
    ).rejects.toBeInstanceOf(NotFoundException)

    await service.assignSandbox({ userId: OWNER, connectionId: CONNECTION, threadId: 'thread-1' })
    await service.assignSandbox({ userId: OWNER, connectionId: CONNECTION, threadId: 'thread-1' })
    const dto = await service.issueAccessToken({ userId: OWNER, connectionId: CONNECTION, sandboxId: 'sbx-1' })
    expect(dto.accessToken).toBe('access-0')
    expect(store.assignments.size).toBe(1)
  })

  it('removes only an owned connection', async () => {
    await upload()
    await expect(service.remove({ userId: 'user-b', connectionId: CONNECTION })).rejects.toBeInstanceOf(NotFoundException)
    await service.remove({ userId: OWNER, connectionId: CONNECTION })
    expect(store.rows.has(CONNECTION)).toBe(false)
  })
})
