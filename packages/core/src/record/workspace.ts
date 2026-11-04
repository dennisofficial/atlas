import { z } from 'zod'

import type { V2Event } from './event'

export const workspacePreparedSchema = z.object({ type: z.literal('workspace-prepared') })

export const workspacePrepareFailedSchema = z.object({
  type: z.literal('workspace-prepare-failed'),
  reason: z.string(),
  inboxHead: z.number().int().min(0),
})

export type WorkspacePrepared = z.infer<typeof workspacePreparedSchema>
export type WorkspacePrepareFailed = z.infer<typeof workspacePrepareFailedSchema>

export enum EWorkspaceState {
  Unprepared = 'unprepared',
  Preparing = 'preparing',
  Prepared = 'prepared',
  Failed = 'failed',
}

export type PrepareFailure = { inboxHead: number; reason: string }

export const isWorkspacePrepared = (events: readonly V2Event[]): boolean =>
  events.some((event) => event.type === 'workspace-prepared' || event.type === 'user-said')

export const lastPrepareFailure = (events: readonly V2Event[]): PrepareFailure | undefined => {
  const failed = events.findLast((event) => event.type === 'workspace-prepare-failed')
  if (failed === undefined || failed.type !== 'workspace-prepare-failed') return undefined
  return { inboxHead: failed.inboxHead, reason: failed.reason }
}

export const workspaceStateOf = (args: {
  events: readonly V2Event[]
  preparing: boolean
  pendingMessageIds: readonly number[]
}): { state: EWorkspaceState; retryPending: boolean; failure: PrepareFailure | undefined } => {
  if (isWorkspacePrepared(args.events)) {
    return { state: EWorkspaceState.Prepared, retryPending: false, failure: undefined }
  }
  const failure = lastPrepareFailure(args.events)
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
