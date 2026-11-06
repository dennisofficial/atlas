import { z } from 'zod'

import type { V2Event } from './event'
import { INBOX_KIND_STOP, type InboxEntry } from './inbox'

export const workspacePreparedSchema = z.object({
  type: z.literal('workspace-prepared'),
  warnings: z.array(z.string()).optional(),
})

export const workspacePrepareFailedSchema = z.object({
  type: z.literal('workspace-prepare-failed'),
  reason: z.string(),
  inboxHead: z.number().int().min(0),
})

export enum EWorkspaceStep {
  Sandbox = 'sandbox',
  Daemon = 'daemon',
  Clone = 'clone',
  Setup = 'setup',
}

export enum EWorkspaceStepState {
  Started = 'started',
  Done = 'done',
  Failed = 'failed',
}

export enum EWorkspaceStepOutcome {
  Created = 'created',
  Resumed = 'resumed',
  Skipped = 'skipped',
}

export enum EWorkspaceRepoState {
  Pending = 'pending',
  Cloning = 'cloning',
  Done = 'done',
  Failed = 'failed',
}

export const workspaceStepRepoSchema = z.object({
  repo: z.string(),
  state: z.enum(EWorkspaceRepoState),
})

export const workspaceStepSchema = z.object({
  type: z.literal('workspace-step'),
  step: z.enum(EWorkspaceStep),
  state: z.enum(EWorkspaceStepState),
  outcome: z.enum(EWorkspaceStepOutcome).optional(),
  reason: z.string().optional(),
  repos: z.array(workspaceStepRepoSchema).optional(),
  command: z.string().optional(),
  output: z.string().optional(),
})

export type WorkspaceStepRepo = z.infer<typeof workspaceStepRepoSchema>

export type WorkspaceStep = z.infer<typeof workspaceStepSchema>
export type WorkspaceStepReport = Omit<WorkspaceStep, 'type'>

export type WorkspacePrepared = z.infer<typeof workspacePreparedSchema>
export type WorkspacePrepareFailed = z.infer<typeof workspacePrepareFailedSchema>

export enum EWorkspaceState {
  Unprepared = 'unprepared',
  Preparing = 'preparing',
  Prepared = 'prepared',
  Failed = 'failed',
}

export type PrepareFailure = { inboxHead: number; reason: string; at: string }

export const isWorkspacePrepared = (events: readonly V2Event[]): boolean =>
  events.some((event) => event.type === 'workspace-prepared' || event.type === 'user-said')

export const lastPrepareFailure = (events: readonly V2Event[]): PrepareFailure | undefined => {
  const failed = events.findLast((event) => event.type === 'workspace-prepare-failed')
  if (failed === undefined || failed.type !== 'workspace-prepare-failed') return undefined
  return { inboxHead: failed.inboxHead, reason: failed.reason, at: failed.at }
}

export const activeFailure = (events: readonly V2Event[]): PrepareFailure | undefined =>
  isWorkspacePrepared(events) ? undefined : lastPrepareFailure(events)

export const actionableInboxIds = (args: {
  entries: readonly Pick<InboxEntry, 'inboxId' | 'kind'>[]
  failure: Pick<PrepareFailure, 'inboxHead'> | undefined
}): number[] =>
  args.entries
    .filter(
      (entry) =>
        entry.kind === INBOX_KIND_STOP ||
        args.failure === undefined ||
        entry.inboxId > args.failure.inboxHead,
    )
    .map((entry) => entry.inboxId)

export type WorkspaceRecord = { prepared: boolean; failure: PrepareFailure | undefined }

export const NO_WORKSPACE_RECORD: WorkspaceRecord = { prepared: false, failure: undefined }

export type WorkspaceStateView = {
  state: EWorkspaceState
  retryPending: boolean
  failure: PrepareFailure | undefined
}

export const workspaceRecordOf = (events: readonly V2Event[]): WorkspaceRecord => ({
  prepared: isWorkspacePrepared(events),
  failure: lastPrepareFailure(events),
})

export const workspaceStateOf = (args: {
  events: readonly V2Event[]
  preparing: boolean
  pendingMessageIds: readonly number[]
}): WorkspaceStateView =>
  workspaceStateFrom({
    record: workspaceRecordOf(args.events),
    preparing: args.preparing,
    pendingMessageIds: args.pendingMessageIds,
  })

export const workspaceStateFrom = (args: {
  record: WorkspaceRecord
  preparing: boolean
  pendingMessageIds: readonly number[]
}): WorkspaceStateView => {
  if (args.record.prepared) {
    return { state: EWorkspaceState.Prepared, retryPending: false, failure: undefined }
  }
  const failure = args.record.failure
  if (args.preparing) return { state: EWorkspaceState.Preparing, retryPending: false, failure }
  if (failure === undefined) {
    return { state: EWorkspaceState.Unprepared, retryPending: false, failure }
  }
  return {
    state: EWorkspaceState.Failed,
    retryPending: args.pendingMessageIds.some((id) => id > failure.inboxHead),
    failure,
  }
}
