import { ESessionStatus } from '@dltech/atlas-core'
import type { Routine, SessionSummary } from '@dltech/atlas-protocol'

export enum ERoutineState {
  Working = 'working',
  Idle = 'idle',
  Skipped = 'skipped',
  Off = 'off',
}

const SETTLED: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Idle,
  ESessionStatus.Failed,
  ESessionStatus.StartFailed,
  ESessionStatus.SetupFailed,
])

export const isRoutineSessionLive = (state: ESessionStatus | undefined): boolean =>
  state !== undefined && !SETTLED.has(state)

export const pushedSessionStateOf = (args: {
  sessionId: string | null
  sessions: readonly SessionSummary[]
}): ESessionStatus | undefined => {
  const { sessionId, sessions } = args
  if (sessionId === null) return undefined
  return sessions.find((session) => session.sessionId === sessionId)?.status?.state
}

export const routineStateOf = (args: {
  routine: Routine
  sessionState: ESessionStatus | undefined
}): ERoutineState => {
  const { routine, sessionState } = args
  if (!routine.enabled) return ERoutineState.Off
  if (isRoutineSessionLive(sessionState)) return ERoutineState.Working
  const lastRunSkipped = routine.lastRunAt !== null && routine.lastSessionId === null
  return lastRunSkipped ? ERoutineState.Skipped : ERoutineState.Idle
}
