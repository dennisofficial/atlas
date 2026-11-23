import { UnauthorizedException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedUsers } from '../../../../test/session-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { PRINCIPAL_CACHE_TTL_MS } from './sandbox-principal-cache'
import { hashSessionToken } from './sandbox-tokens'
import { databaseEnv } from './sandboxes.fixture'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import type { VercelSandboxClient } from './vercel-sandbox.client'
import { inertSignals } from '../sessions/thread-signals.fixture'

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

describe('SandboxesService.verifyTokenPrincipal', () => {
  useTestDatabase()
  let service: SandboxesService

  afterEach(() => vi.restoreAllMocks())

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b')
    service = new SandboxesService(
      {} as unknown as VercelSandboxClient,
      cipher,
      inertSignals(),
      databaseEnv(),
    )
    await seedSandboxRow({
      id: 'sbx_1',
      userId: 'user-a',
      threadId: 'brn_sandbox',
      tokenHash: hashSessionToken('sandbox-token'),
    })
    await db.orm.public.LocalPodLease.create({
      id: 'lease_1',
      userId: 'user-b',
      threadId: 'brn_pod',
      tokenHash: hashSessionToken('pod-token'),
    })
  })

  it('resolves a cloud sandbox token to the sandbox principal', async () => {
    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).resolves.toEqual({
      kind: ETokenPrincipalKind.Sandbox,
      id: 'sbx_1',
      threadId: 'brn_sandbox',
      userId: 'user-a',
    })
  })

  it('falls through to the pod lease on a sandbox miss, carrying no sandbox id', async () => {
    const principal = await service.verifyTokenPrincipal({ token: 'pod-token' })

    expect(principal).toEqual({
      kind: ETokenPrincipalKind.Pod,
      threadId: 'brn_pod',
      userId: 'user-b',
    })
    expect(principal).not.toHaveProperty('id')
  })

  it('refuses a token held by both tables, whoever owns each row', async () => {
    await db.orm.public.LocalPodLease.create({
      id: 'lease_2',
      userId: 'user-b',
      threadId: 'brn_pod_2',
      tokenHash: hashSessionToken('sandbox-token'),
    })

    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await expect(service.verifyTokenPrincipal({ token: 'pod-token' })).resolves.toMatchObject({
      kind: ETokenPrincipalKind.Pod,
    })
  })

  it('refuses a token that neither table holds', async () => {
    await expect(service.verifyTokenPrincipal({ token: 'unknown' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('answers a repeated request from the principal cache', async () => {
    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).resolves.toMatchObject({
      id: 'sbx_1',
    })
    await db.orm.public.CloudSandbox.where({ id: 'sbx_1' }).delete()

    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).resolves.toEqual({
      kind: ETokenPrincipalKind.Sandbox,
      id: 'sbx_1',
      threadId: 'brn_sandbox',
      userId: 'user-a',
    })
  })

  it('drops a cached principal once its ttl passes', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await service.verifyTokenPrincipal({ token: 'sandbox-token' })
    await db.orm.public.CloudSandbox.where({ id: 'sbx_1' }).delete()

    clock.mockReturnValue(now + PRINCIPAL_CACHE_TTL_MS + 1)
    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('never caches a miss', async () => {
    await expect(service.verifyTokenPrincipal({ token: 'late-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await db.orm.public.CloudSandbox.where({ id: 'sbx_1' }).update({
      tokenHash: hashSessionToken('late-token'),
    })

    await expect(service.verifyTokenPrincipal({ token: 'late-token' })).resolves.toMatchObject({
      id: 'sbx_1',
    })
  })

  it('forgets the previous token the moment a claim rotates it', async () => {
    await service.verifyTokenPrincipal({ token: 'sandbox-token' })

    await service.claim({ userId: 'user-a', threadId: 'brn_sandbox' })

    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('does not cache a principal whose lookup outlived the destroy that revoked it', async () => {
    const held = Promise.withResolvers<void>()
    const real = service.lookupPrincipal
    service.lookupPrincipal = async (tokenHash) => {
      const resolved = await real(tokenHash)
      await held.promise
      return resolved
    }

    const raced = service.verifyTokenPrincipal({ token: 'sandbox-token' })
    await service.destroy({ userId: 'user-a', threadId: 'brn_sandbox' })
    held.resolve()
    await expect(raced).resolves.toMatchObject({ id: 'sbx_1' })

    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('forgets a destroyed sandbox at once', async () => {
    await service.verifyTokenPrincipal({ token: 'sandbox-token' })

    await service.destroy({ userId: 'user-a', threadId: 'brn_sandbox' })

    await expect(service.verifyTokenPrincipal({ token: 'sandbox-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})
