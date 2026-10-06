import {
  EQualityReviewStatus,
  EQualitySkipReason,
  type ThreadId,
  type WorkspaceIdentityPort,
} from '@dltech/atlas-core'

import { withQualityDeadline } from './deadline'

export type NamespaceFailure = { status: EQualityReviewStatus; reason: EQualitySkipReason; detail: string }

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const unidentified = (detail: string): NamespaceFailure => ({
  status: EQualityReviewStatus.OperationalError,
  reason: EQualitySkipReason.WorkspaceUnidentified,
  detail,
})

export async function resolveWorkspaceNamespace({
  identity,
  projectDirectory,
  threadId,
  signal,
  deadlineMs,
}: {
  identity: WorkspaceIdentityPort
  projectDirectory: string
  threadId: ThreadId
  signal: AbortSignal
  deadlineMs: number
}): Promise<string | NamespaceFailure> {
  const raced = await withQualityDeadline({
    signal,
    deadlineMs,
    work: () => identity.identify({ projectDirectory, threadId }),
  })
  if (raced.kind === 'aborted') {
    return { status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.TurnInterrupted, detail: 'turn interrupted' }
  }
  if (raced.kind === 'deadline') {
    return {
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
      detail: `workspace identity probe exceeded ${deadlineMs}ms`,
    }
  }
  if (raced.kind === 'failed') return unidentified(describeError(raced.error))

  const { remote, worktreePath } = raced.value
  if (remote === null || remote === '') return unidentified('workspace has no remote identity')
  return worktreePath === null || worktreePath === '' ? remote : `${remote}#${worktreePath}`
}
