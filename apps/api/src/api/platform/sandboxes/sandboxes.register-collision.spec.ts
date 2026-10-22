import { ConflictException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { hashSessionToken } from './sandbox-tokens'
import { SandboxesService } from './sandboxes.service'
import type { VercelSandboxClient } from './vercel-sandbox.client'

const TOKEN = 'b'.repeat(64)
const SERVE_URL = 'https://atlas-3000-abc.vercel.run'

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

describe('registering a client token that a pod lease already holds', () => {
  useTestDatabase()
  let service: SandboxesService

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b')
    service = new SandboxesService(
      {} as unknown as VercelSandboxClient,
      cipher,
    )
    await db.orm.public.LocalPodLease.create({
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

    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
    expect(await db.orm.public.Thread.all()).toHaveLength(0)
  })
})
