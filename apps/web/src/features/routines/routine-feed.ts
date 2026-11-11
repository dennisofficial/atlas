import type { ESessionStatus } from '@dltech/atlas-core'
import type { Routine, SessionSummary } from '@dltech/atlas-protocol'

import { isRoutineSessionLive } from './routine-state'

export type RoutineFeedRun = {
  routineId: string
  sessionId: string
  state: ESessionStatus | undefined
}

export const routineRunsOf = (sessions: readonly SessionSummary[]): readonly RoutineFeedRun[] =>
  sessions.flatMap((session) => {
    const routineId = session.routineId
    if (routineId === null || routineId === undefined) return []
    return [{ routineId, sessionId: session.sessionId, state: session.status?.state }]
  })

const claimedSessionIdsOf = (routines: readonly Routine[]): ReadonlySet<string> =>
  new Set(
    routines.flatMap((routine) => (routine.lastSessionId === null ? [] : [routine.lastSessionId])),
  )

export const routineFeedInvalidationsOf = (args: {
  seen: readonly RoutineFeedRun[]
  runs: readonly RoutineFeedRun[]
  routines: readonly Routine[]
}): readonly string[] => {
  const claimed = claimedSessionIdsOf(args.routines)
  const seen = new Map(args.seen.map((run) => [run.sessionId, run]))
  const routineIds = new Set<string>()
  for (const run of args.runs) {
    const before = seen.get(run.sessionId)
    const appeared = before === undefined && !claimed.has(run.sessionId)
    const settled =
      before !== undefined && isRoutineSessionLive(before.state) && !isRoutineSessionLive(run.state)
    if (appeared || settled) routineIds.add(run.routineId)
  }
  return [...routineIds]
}
