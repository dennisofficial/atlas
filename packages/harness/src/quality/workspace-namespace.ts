import {
  EQualityReviewStatus,
  EQualitySkipReason,
  type ThreadId,
  type WorkspaceIdentityPort,
} from '@dltech/atlas-core'

import { settleUnderBudget } from './deadline'
import { WorkspaceIdentityDeadlineError } from './git-workspace-identity'

export type NamespaceFailure = { status: EQualityReviewStatus; reason: EQualitySkipReason; detail: string }

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const unidentified = (detail: string): NamespaceFailure => ({
  status: EQualityReviewStatus.OperationalError,
  reason: EQualitySkipReason.WorkspaceUnidentified,
  detail,
})

const deadlineFailure = (detail: string): NamespaceFailure => ({
  status: EQualityReviewStatus.OperationalError,
  reason: EQualitySkipReason.ReviewDeadline,
  detail,
})

export async function resolveWorkspaceNamespace({
  identity,
  projectDirectory,
  threadId,
  signal,
}: {
  identity: WorkspaceIdentityPort
  projectDirectory: string
  threadId: ThreadId
  signal: AbortSignal
}): Promise<string | NamespaceFailure> {
  const raced = await settleUnderBudget({
    signal,
    work: () => identity.identify({ projectDirectory, threadId }),
  })
  if (raced.kind === 'aborted') {
    return { status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.TurnInterrupted, detail: 'turn interrupted' }
  }
  if (raced.kind === 'deadline') return deadlineFailure(`workspace identity: ${raced.error.message}`)
  if (raced.kind === 'failed') {
    return raced.error instanceof WorkspaceIdentityDeadlineError
      ? deadlineFailure(describeError(raced.error))
      : unidentified(describeError(raced.error))
  }

  const { remote, worktreePath } = raced.value
  if (remote === null || remote === '') return unidentified('workspace has no remote identity')
  return worktreePath === null || worktreePath === '' ? remote : `${remote}#${worktreePath}`
}
