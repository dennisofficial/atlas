import type { EnvService } from '../../../_core/config/env/env.service'
import { vi } from 'bun:test'
import {
  seedSandboxRow,
  seedThreadRow,
  seedUsers,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'
import type { VercelSandboxClient } from './vercel-sandbox.client'

export const THREAD = 'brn_thread_1'

export const sandboxRow = (partial: Parameters<typeof seedSandboxRow>[0]) =>
  seedSandboxRow({
    sandboxId: 'ses_old',
    state: ESandboxState.Running,
    lastActivityAt: new Date('2026-09-16T00:00:00.000Z'),
    tokenHash: `hash_${partial.threadId}`,
    ...partial,
  })

export const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

const stubClient = () => ({
  inspect: vi.fn(async (): Promise<{ state: ESandboxState; url?: string }> => ({
    state: ESandboxState.Parked,
  })),
  stop: vi.fn(async () => undefined),
  notifyParked: vi.fn(async () => undefined),
})

export type StubClient = ReturnType<typeof stubClient>

export async function prepareSandboxes(): Promise<{ client: StubClient; service: SandboxesService }> {
  await seedUsers(USER_A, USER_B)
  await seedThreadRow({ id: THREAD, workspace: '/repo', repo: '/repo', executionLocation: 'cloud' })
  const client = stubClient()
  const service = new SandboxesService(client as unknown as VercelSandboxClient, cipher)
  return { client, service }
}
