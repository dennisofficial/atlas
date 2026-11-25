import {
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  latestAttemptOf,
  nextAttemptOf,
  setupFinishedText,
  type RunId,
  type ThreadId,
  type RecordEvent,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'

import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'

const SETUP_STOPPED_REASON = 'setup was stopped with the session'

export const prepareAttemptOf = (args: {
  events: readonly RecordEvent[]
  resuming: boolean
}): number | undefined =>
  args.resuming ? latestAttemptOf(args.events) || undefined : nextAttemptOf(args.events)

export const attemptFieldOf = (attempt: number | undefined): { attempt?: number } =>
  attempt === undefined ? {} : { attempt }

export const elapsedMsOf = (args: { startedAt: number; nowMs: number }): number => {
  // with no recorded start, now - 0 would report the whole Unix epoch as the duration
  if (args.startedAt === 0) return 0
  return Math.max(0, args.nowMs - args.startedAt)
}

export const stoppedSetupDraftsOf = (args: {
  script: string
  attempt: number | undefined
  durationMs: number
}): AppendBody[] => [
  {
    type: 'workspace-step',
    step: EWorkspaceStep.Setup,
    state: EWorkspaceStepState.Failed,
    reason: SETUP_STOPPED_REASON,
    ...(args.script === '' ? {} : { command: args.script }),
    ...attemptFieldOf(args.attempt),
  },
  {
    type: 'sandbox-setup-reported',
    text: setupFinishedText({
      script: args.script,
      ok: false,
      durationMs: args.durationMs,
      output: '',
    }),
    failed: true,
    phase: ESetupPhase.Finished,
  },
]

export const appendAttemptStarted = async (args: {
  record: SessionRecord
  threadId: ThreadId
  runId: RunId
  attempt: number
  abandoned(): boolean
}): Promise<void> => {
  if (args.abandoned()) return
  await args.record.append({
    threadId: args.threadId,
    runId: args.runId,
    drafts: [{ type: 'workspace-attempt-started', attempt: args.attempt }],
  })
}

export const appendSetupStep = async (args: {
  record: SessionRecord
  threadId: ThreadId
  runId: RunId
  attempt: number | undefined
  step: WorkspaceStepReport
  abandoned(): boolean
}): Promise<void> => {
  if (args.abandoned()) return
  await args.record.append({
    threadId: args.threadId,
    runId: args.runId,
    drafts: [{ type: 'workspace-step', ...args.step, ...attemptFieldOf(args.attempt) }],
  })
}
