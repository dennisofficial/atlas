import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { ECloudSandboxState } from './sandbox-client'

export enum ECloudSandboxLifecycle {
  Running = 'running',
  Parked = 'parked',
  Stopped = 'stopped',
  Unknown = 'unknown',
}

export enum ECloudFreshness {
  Synced = 'synced',
  Behind = 'behind',
  Unknown = 'unknown',
}

export function transcriptFreshnessOf(args: {
  threadId: string
  lifecycle: ECloudSandboxLifecycle
  checkpoint?: RuntimeCheckpoint | null | undefined
  observedSandboxSessionId?: string | undefined
  applied?: { head: number; count: number; digest: string } | undefined
}): ECloudFreshness {
  if (args.lifecycle !== ECloudSandboxLifecycle.Parked) return ECloudFreshness.Unknown

  const checkpoint = args.checkpoint ?? null
  if (checkpoint === null || args.applied === undefined) return ECloudFreshness.Unknown
  if (checkpoint.threadId !== args.threadId) return ECloudFreshness.Unknown
  if (checkpoint.phase !== ERuntimePhase.Parked) return ECloudFreshness.Unknown
  if (
    args.observedSandboxSessionId === undefined ||
    checkpoint.sandboxSessionId !== args.observedSandboxSessionId
  ) {
    return ECloudFreshness.Unknown
  }

  const transcript = checkpoint.transcript
  const same =
    transcript.head === args.applied.head &&
    transcript.count === args.applied.count &&
    transcript.digest === args.applied.digest
  return same ? ECloudFreshness.Synced : ECloudFreshness.Behind
}

export const cloudLifecycleOf = (state: ECloudSandboxState): ECloudSandboxLifecycle => {
  if (state === ECloudSandboxState.Parked) return ECloudSandboxLifecycle.Parked
  if (state === ECloudSandboxState.Stopped) return ECloudSandboxLifecycle.Stopped
  if (state === ECloudSandboxState.Unknown) return ECloudSandboxLifecycle.Unknown
  return ECloudSandboxLifecycle.Running
}

export function isTranscriptMuted(args: {
  lifecycle: ECloudSandboxLifecycle
  socketOpen: boolean
  freshness: ECloudFreshness
}): boolean {
  if (args.socketOpen) return args.freshness !== ECloudFreshness.Synced
  if (args.lifecycle === ECloudSandboxLifecycle.Parked && args.freshness === ECloudFreshness.Synced) {
    return false
  }
  return true
}

export enum EClosedConnectionKind {
  Parked = 'parked',
  Reconnecting = 'reconnecting',
  Closed = 'closed',
}

export const closedConnectionOf = (args: {
  state: ECloudSandboxState
  resuming: string
  missing: string
  running: string
}): { kind: EClosedConnectionKind; detail: string | null } => {
  if (args.state === ECloudSandboxState.Parked) return { kind: EClosedConnectionKind.Parked, detail: null }
  if (args.state === ECloudSandboxState.Resuming) {
    return { kind: EClosedConnectionKind.Reconnecting, detail: args.resuming }
  }
  if (args.state === ECloudSandboxState.Running) {
    return { kind: EClosedConnectionKind.Closed, detail: args.running }
  }
  return { kind: EClosedConnectionKind.Closed, detail: args.missing }
}
