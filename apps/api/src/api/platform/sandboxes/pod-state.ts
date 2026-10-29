import { EBootStepState, EPodState, ESandboxProvisionState } from '@dltech/atlas-wire'
import type { Row } from '@dltech/atlas-db'
import { parkedOf, wakeClaimActive } from './sandbox-lifecycle'
import { ESandboxState } from './sandboxes.types'

export const failedAfterClaim = (row: Row<'CloudSandbox'>): boolean =>
  row.wakeFailedAt !== null &&
  (row.wakeClaim === null || row.wakeFailedAt.getTime() >= row.wakeClaim.getTime())

export function standingStateOf(row: Row<'CloudSandbox'>): ESandboxProvisionState | undefined {
  if (row.state === ESandboxState.Running && row.serveUrl && !parkedOf(row)) {
    return ESandboxProvisionState.Running
  }
  const failedAfterWakeClaim =
    row.wakeFailedAt !== null &&
    row.wakeClaim !== null &&
    row.wakeFailedAt.getTime() > row.wakeClaim.getTime()
  if (wakeClaimActive(row) && !failedAfterWakeClaim) return ESandboxProvisionState.Booting
  return undefined
}

export function podStateOf(args: {
  row: Row<'CloudSandbox'> | null
  lastBootStepState: EBootStepState | undefined
}): EPodState {
  const { row, lastBootStepState } = args
  const standing = row === null ? undefined : standingStateOf(row)
  if (standing === ESandboxProvisionState.Running) return EPodState.Running
  if (standing === ESandboxProvisionState.Booting) return EPodState.Booting
  if (lastBootStepState === EBootStepState.Error) return EPodState.Failed
  if (row !== null && failedAfterClaim(row)) return EPodState.Failed
  if (row !== null && parkedOf(row)) return EPodState.Parked
  return EPodState.None
}
