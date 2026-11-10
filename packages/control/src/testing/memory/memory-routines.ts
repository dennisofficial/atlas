import type { AdvanceRoutineParams, InsertRoutineRunParams, RoutineRow } from '../../port'
import type { State } from './memory-state'

export const readRoutineIn = async (params: {
  state: State
  routineId: string
}): Promise<RoutineRow | undefined> => {
  const row = params.state.routines.get(params.routineId)
  return row === undefined ? undefined : { ...row }
}

export const lockRoutineIn = (params: {
  state: State
  routineId: string
}): Promise<RoutineRow | undefined> => readRoutineIn(params)

export const advanceRoutineIn = async (
  params: AdvanceRoutineParams & { state: State },
): Promise<boolean> => {
  const row = params.state.routines.get(params.routineId)
  if (row === undefined || row.nextRunAt !== params.expectedNextRunAt) return false
  params.state.routines.set(params.routineId, {
    ...row,
    nextRunAt: params.nextRunAt,
    updatedAt: params.at,
    ...(params.lastRunAt === undefined ? {} : { lastRunAt: params.lastRunAt }),
    ...(params.lastSessionId === undefined ? {} : { lastSessionId: params.lastSessionId }),
  })
  return true
}

export const insertRoutineRunIn = async (
  params: InsertRoutineRunParams & { state: State },
): Promise<void> => {
  const { state, ...run } = params
  state.routineRuns.push({ ...run })
}

const byOccurrence = (left: RoutineRow, right: RoutineRow): number =>
  Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt) ||
  (left.routineId < right.routineId ? -1 : 1)

export const dueRoutinesIn = (params: {
  state: State
  now: string
  limit: number
}): RoutineRow[] => {
  const nowMs = Date.parse(params.now)
  return [...params.state.routines.values()]
    .filter((row) => row.enabled && Date.parse(row.nextRunAt) <= nowMs)
    .sort(byOccurrence)
    .slice(0, params.limit)
    .map((row) => ({ ...row }))
}
