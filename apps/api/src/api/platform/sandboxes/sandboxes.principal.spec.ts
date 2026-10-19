import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeSessionDb } = await import('../../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb, type FakeCloudSandboxRow } from '../../../../test/fake-session-db.js'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { SandboxGitCredentials } from './git-credentials'
import { hashSessionToken } from './sandbox-tokens'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import type { VercelSandboxClient } from './vercel-sandbox.client'

const sessions = fakeSessionDb()

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

describe('SandboxesService.verifyTokenPrincipal', () => {
  let service: SandboxesService

  beforeEach(() => {
    sessions.reset()
    service = new SandboxesService(
      {} as unknown as VercelSandboxClient,
      {} as unknown as SandboxGitCredentials,
      cipher,
    )
    sessions.cloudSandboxes.push({
      id: 'sbx_1',
      userId: 'user-a',
      threadId: 'brn_sandbox',
      tokenHash: hashSessionToken('sandbox-token'),
    } as unknown as FakeCloudSandboxRow)
    sessions.podLeaseRows.push({
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

    expect(principal).toEqual({ kind: ETokenPrincipalKind.Pod, threadId: 'brn_pod', userId: 'user-b' })
    expect(principal).not.toHaveProperty('id')
  })

  it('refuses a token held by both tables, whoever owns each row', async () => {
    sessions.podLeaseRows.push({
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
})
