import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeSessionDb } = await import('../../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb } from '../../../../test/fake-session-db.js'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { SandboxGitCredentials } from './git-credentials'
import { hashSessionToken } from './sandbox-tokens'
import { SandboxesService } from './sandboxes.service'
import type { VercelSandboxClient } from './vercel-sandbox.client'

const fake = fakeSessionDb()
const TOKEN = 'b'.repeat(64)
const SERVE_URL = 'https://atlas-3000-abc.vercel.run'

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

describe('registering a client token that a pod lease already holds', () => {
  let service: SandboxesService

  beforeEach(() => {
    fake.reset()
    service = new SandboxesService(
      {} as unknown as VercelSandboxClient,
      {} as unknown as SandboxGitCredentials,
      cipher,
    )
    fake.podLeaseRows.push({
      id: 'lease_1',
      userId: 'user-b',
      threadId: 'brn_pod',
      tokenHash: hashSessionToken(TOKEN),
    })
  })

  it.each(['user-a', 'user-b'])('refuses with a conflict for owner %s and writes nothing', async (userId) => {
    await expect(
      service.claim({ userId, threadId: 'brn_new', clientToken: TOKEN, serveUrl: SERVE_URL }),
    ).rejects.toBeInstanceOf(ConflictException)

    expect(fake.cloudSandboxes).toHaveLength(0)
    expect(fake.threads).toHaveLength(0)
  })
})
