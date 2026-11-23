import type { AtlasNotification } from './model'
import { ENotifyMoment } from './moment'

export const ROUTINE_FAILURE_SESSION_PREFIX = 'routine-'

const BODY_LIMIT = 200

const FALLBACK_TITLE = 'Atlas routine'

export type RoutineFailureFacts = {
  routineId: string
  routineName: string
  reason: string
  enabled: boolean
  quiet: boolean
  now: string
}

export const routineFailureNotificationOf = (
  facts: RoutineFailureFacts,
): AtlasNotification | null => {
  if (!facts.enabled || facts.quiet) return null
  const title = facts.routineName.trim()
  return {
    sessionId: `${ROUTINE_FAILURE_SESSION_PREFIX}${facts.routineId}`,
    seq: 0,
    moment: ENotifyMoment.TurnFailed,
    title: title === '' ? FALLBACK_TITLE : title,
    body: `Scheduled run did not start. ${facts.reason}`.slice(0, BODY_LIMIT),
    at: facts.now,
    routineId: facts.routineId,
  }
}
