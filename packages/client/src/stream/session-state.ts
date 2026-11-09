import { ESessionStatus } from '@dltech/atlas-core'
import { EStreamErrorCode } from '@dltech/atlas-protocol'

import { ESessionConnection, type SessionSnapshot } from './session-follower'

type Status = SessionSnapshot['status']

const WORKING: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Preparing,
  ESessionStatus.Sent,
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.Resuming,
])

const FAILED: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Failed,
  ESessionStatus.SetupFailed,
  ESessionStatus.StartFailed,
])

export const isSessionWorking = (status: Status): boolean =>
  status !== undefined && WORKING.has(status.state)

export const isSessionFailed = (status: Status): boolean =>
  status !== undefined && FAILED.has(status.state)

const CONNECTION_LINE: Record<ESessionConnection, string | null> = {
  [ESessionConnection.Live]: null,
  [ESessionConnection.CatchingUp]: 'Catching up…',
  [ESessionConnection.Reconnecting]: 'Reconnecting…',
  [ESessionConnection.Offline]: 'Offline — reload to reconnect',
}

const ERROR_LINE: Record<EStreamErrorCode, string> = {
  [EStreamErrorCode.NotFound]: 'Session not found',
  [EStreamErrorCode.ForbiddenLimit]: 'Too many open sessions',
  [EStreamErrorCode.BadFrame]: 'Stream error — reload',
  [EStreamErrorCode.Internal]: 'Stream error — reload',
}

const errorLineOf = (error: SessionSnapshot['error']): string | null =>
  error === undefined ? null : ERROR_LINE[error]

const statusLineOf = (status: Status): string | null => {
  if (status?.state === ESessionStatus.SetupFailed) {
    return status.reason === undefined ? 'Setup failed' : `Setup failed: ${status.reason}`
  }
  if (status?.state === ESessionStatus.WaitingForCredentials) return 'Waiting for model credentials'
  return null
}

export const sessionStateLineOf = (
  snapshot: Pick<SessionSnapshot, 'status' | 'connection' | 'error'>,
): string | null =>
  statusLineOf(snapshot.status) ??
  errorLineOf(snapshot.error) ??
  CONNECTION_LINE[snapshot.connection]
