import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { Row } from '@dltech/atlas-db'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { ESandboxState } from './sandboxes.types'

export const WAKE_CLAIM_TTL_MS = 15 * 60 * 1_000

export type SandboxLifecycleColumns = Pick<
  Row<'CloudSandbox'>,
  | 'sessionId'
  | 'state'
  | 'runtimeCheckpoint'
  | 'runtimeCheckpointRevision'
  | 'wakeClaim'
  | 'pendingVcpus'
>

export const SANDBOX_LIFECYCLE_COLUMNS = [
  'sessionId',
  'state',
  'runtimeCheckpoint',
  'runtimeCheckpointRevision',
  'wakeClaim',
  'pendingVcpus',
] as const

const STATE_OF_PHASE: Readonly<Record<ERuntimePhase, ESandboxState>> = {
  [ERuntimePhase.Serving]: ESandboxState.Running,
  [ERuntimePhase.Parking]: ESandboxState.Parked,
  [ERuntimePhase.Parked]: ESandboxState.Parked,
  [ERuntimePhase.Provisioning]: ESandboxState.Resuming,
  [ERuntimePhase.Waking]: ESandboxState.Resuming,
  [ERuntimePhase.Updating]: ESandboxState.Resuming,
}

const legacyStateOf = (column: string): ESandboxState => {
  if (column === ESandboxState.Running) return ESandboxState.Running
  if (column === ESandboxState.Resuming) return ESandboxState.Resuming
  return ESandboxState.Parked
}

function mirroredRecordOf(row: SandboxLifecycleColumns): RuntimeCheckpoint | null {
  return storedCheckpointOf({
    checkpoint: row.runtimeCheckpoint,
    revision: row.runtimeCheckpointRevision,
  })
}

export function mirroredPhaseOf(row: SandboxLifecycleColumns): ERuntimePhase | null {
  return mirroredRecordOf(row)?.phase ?? null
}

/**
 * A wake claim holds until serve mirrors any record reported after it, or until it ages past the
 * TTL (an API process that died mid-wake). A successful wake therefore never clears its claim:
 * serve's own Serving mirror supersedes it.
 */
export function wakeClaimActive(row: SandboxLifecycleColumns): boolean {
  if (!row.wakeClaim) return false
  const claimedAt = row.wakeClaim.getTime()
  if (!Number.isFinite(claimedAt) || Date.now() - claimedAt >= WAKE_CLAIM_TTL_MS) return false
  if (row.pendingVcpus !== null) return true
  const record = mirroredRecordOf(row)
  return record === null || Date.parse(record.reportedAt) < claimedAt
}

/**
 * The mirrored lifecycle record wins; the legacy `state` column answers only for a row no
 * released serve has mirrored a parseable record onto. An in-flight API wake reads as Resuming
 * until serve's own record supersedes the claim.
 */
export function sandboxStateOf(row: SandboxLifecycleColumns): ESandboxState {
  const phase = mirroredPhaseOf(row)
  const settled = phase === null ? legacyStateOf(row.state) : STATE_OF_PHASE[phase]
  if (settled === ESandboxState.Parked && wakeClaimActive(row)) return ESandboxState.Resuming
  return settled
}

/** Parking is excluded: serve is still stopping that sandbox, and a resume would race the stop. */
export function parkedOf(row: SandboxLifecycleColumns): boolean {
  const phase = mirroredPhaseOf(row)
  if (phase === null) return legacyStateOf(row.state) === ESandboxState.Parked
  return phase === ERuntimePhase.Parked
}

export function wakeableOf(row: SandboxLifecycleColumns): boolean {
  return !wakeClaimActive(row) && parkedOf(row)
}
