import { ESessionStatus } from '@dltech/atlas-core'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { EHeaderState } from '@/features/threads/data/header-model'

type Status = SessionSnapshot['status']

const WORKING: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Preparing,
  ESessionStatus.Sent,
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.Resuming,
])

export const isSessionWorking = (status: Status): boolean =>
  status !== undefined && WORKING.has(status.state)

const CONNECTION_LINE: Record<ESessionConnection, string | null> = {
  [ESessionConnection.Live]: null,
  [ESessionConnection.CatchingUp]: 'Catching up…',
  [ESessionConnection.Reconnecting]: 'Reconnecting…',
  [ESessionConnection.Offline]: 'Offline — reload to reconnect',
}

const statusLineOf = (status: Status): string | null => {
  if (status?.state === ESessionStatus.SetupFailed) {
    return status.reason === undefined ? 'Setup failed' : `Setup failed: ${status.reason}`
  }
  if (status?.state === ESessionStatus.WaitingForCredentials) return 'Waiting for model credentials'
  return null
}

export const sessionStateLineOf = (
  snapshot: Pick<SessionSnapshot, 'status' | 'connection'>,
): string | null => statusLineOf(snapshot.status) ?? CONNECTION_LINE[snapshot.connection]

export const headerStateOfSession = (status: Status): EHeaderState => {
  if (status === undefined) return EHeaderState.Idle
  if (status.state === ESessionStatus.Failed || status.state === ESessionStatus.SetupFailed) {
    return EHeaderState.Failed
  }
  if (status.state === ESessionStatus.WaitingForCredentials) return EHeaderState.NeedsYou
  return isSessionWorking(status) ? EHeaderState.Running : EHeaderState.Idle
}
