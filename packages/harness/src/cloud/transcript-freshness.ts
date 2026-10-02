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

export enum EParkedResume {
  Synced = 'synced',
  Behind = 'behind',
  Unknown = 'unknown',
}

export type ParkedTranscriptRecord = {
  checkpoint: RuntimeCheckpoint
  applied: { head: number; count: number; digest: string } | null
}

export function parkedResumeOf(args: { record: ParkedTranscriptRecord | null }): EParkedResume {
  const record = args.record
  if (record === null) return EParkedResume.Unknown
  if (record.checkpoint.phase !== ERuntimePhase.Parked) return EParkedResume.Unknown
  if (record.applied === null) return EParkedResume.Behind
  const transcript = record.checkpoint.transcript
  const same =
    transcript.head === record.applied.head &&
    transcript.count === record.applied.count &&
    transcript.digest === record.applied.digest
  return same ? EParkedResume.Synced : EParkedResume.Behind
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
  Waking = 'waking',
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
    return { kind: EClosedConnectionKind.Waking, detail: args.resuming }
  }
  if (args.state === ECloudSandboxState.Running) {
    return { kind: EClosedConnectionKind.Closed, detail: args.running }
  }
  return { kind: EClosedConnectionKind.Closed, detail: args.missing }
}
