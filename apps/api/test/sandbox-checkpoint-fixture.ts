import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import {
  fakeSessionDb,
  type FakeCloudSandboxRow,
} from './fake-session-db'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { storedCheckpointOf } from '../src/api/platform/sandboxes/sandbox-checkpoint'
import { mintSessionToken } from '../src/api/platform/sandboxes/sandbox-tokens'
import type { SandboxAuthenticatedRequest } from '../src/api/platform/sandboxes/sandbox-token.guard'

export const USER_A = 'user-a'
export const USER_B = 'user-b'
export const THREAD = 'brn_thread_1'

export const fake = fakeSessionDb()
export const minted = mintSessionToken()

export const sandboxRow = (
  partial: Partial<FakeCloudSandboxRow> & { threadId: string },
): FakeCloudSandboxRow => ({
  id: `sbx_${partial.threadId}`,
  userId: USER_A,
  sandboxId: 'sandbox-id',
  name: 'sandbox-name',
  region: 'iad1',
  state: 'running',
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  tokenHash: minted.tokenHash,
  sealedToken: null,
  workspaceRemoteUrl: null,
  workspaceBranch: null,
  workspaceCommit: null,
  workspacePatch: null,
  workspaceSkills: null,
  workspaceContext: null,
  workspaceProjectDirectory: null,
  runtimeCheckpointRevision: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...partial,
})

export const storedRow = (
  checkpoint: RuntimeCheckpoint,
  partial: Partial<FakeCloudSandboxRow> = {},
): FakeCloudSandboxRow =>
  sandboxRow({
    threadId: THREAD,
    runtimeCheckpoint: checkpoint,
    runtimeCheckpointRevision: checkpoint.revision,
    ...partial,
  })

export const checkpoint = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: THREAD,
  runtimeId: 'runtime-abc',
  sandboxSessionId: 'sandbox-session-xyz',
  revision: 3,
  phase: ERuntimePhase.Running,
  reportedAt: '2026-10-01T12:00:00.000Z',
  transcript: { head: 41, count: 40, digest: 'b'.repeat(64) },
  ...overrides,
})

export const storedInRow = (): RuntimeCheckpoint | null => {
  const row = fake.cloudSandboxes[0]
  return storedCheckpointOf({
    threadId: THREAD,
    checkpoint: row?.runtimeCheckpoint,
    revision: row?.runtimeCheckpointRevision ?? null,
  })
}

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
