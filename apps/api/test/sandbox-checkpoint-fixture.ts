import { ERuntimePhase, runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { asJson, seedSandboxRow, seedUsers, USER_A, USER_B } from './session-seed'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { storedCheckpointOf } from '../src/api/platform/sandboxes/sandbox-checkpoint'
import { mintSessionToken } from '../src/api/platform/sandboxes/sandbox-tokens'
import type { SandboxAuthenticatedRequest } from '../src/api/platform/sandboxes/sandbox-token.guard'

export const THREAD = 'brn_thread_1'

export const minted = mintSessionToken()

export const seedCheckpointOwners = (): Promise<void> => seedUsers(USER_A, USER_B)

export const sandboxRow = (
  partial: Partial<Row<'CloudSandbox'>> & { threadId: string },
): Promise<Row<'CloudSandbox'>> =>
  seedSandboxRow({
    state: 'running',
    tokenHash: minted.tokenHash,
    lastActivityAt: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...partial,
  })

export const storedRow = (
  stored: RuntimeCheckpoint,
  partial: Partial<Row<'CloudSandbox'>> = {},
): Promise<Row<'CloudSandbox'>> =>
  sandboxRow({
    threadId: THREAD,
    runtimeCheckpoint: asJson(stored),
    runtimeCheckpointRevision: stored.revision,
    ...partial,
  })

export const checkpoint = (overrides: Record<string, unknown> = {}): RuntimeCheckpoint =>
  ({
    threadId: THREAD,
    runtimeId: 'runtime-abc',
    sandboxSessionId: 'sandbox-session-xyz',
    revision: 3,
    phase: ERuntimePhase.Serving,
    reportedAt: '2026-10-01T12:00:00.000Z',
    transcript: { head: 41, count: 40, digest: 'b'.repeat(64) },
    ...overrides,
  }) as RuntimeCheckpoint

export const validCheckpoint = (overrides: Record<string, unknown> = {}): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse(checkpoint(overrides))

export const storedInRow = async (): Promise<RuntimeCheckpoint | null> => {
  const row = await db.orm.public.CloudSandbox.first()
  return storedCheckpointOf({
    threadId: THREAD,
    checkpoint: row?.runtimeCheckpoint,
    revision: row?.runtimeCheckpointRevision ?? null,
  })
}

export { USER_A, USER_B }

export const ownerRequest = (userId: string): AuthenticatedRequest =>
  ({ auth: { userId } }) as unknown as AuthenticatedRequest

export const sandboxRequest = (args: {
  threadId?: string
  userId?: string
  token?: string
}): SandboxAuthenticatedRequest =>
  ({
    params: { threadId: args.threadId ?? THREAD },
    headers: { authorization: `Bearer ${args.token ?? minted.token}` },
    sandbox: { threadId: args.threadId ?? THREAD, userId: args.userId ?? USER_A },
  }) as unknown as SandboxAuthenticatedRequest
