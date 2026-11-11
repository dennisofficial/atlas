import type {
  AdvanceRoutineParams,
  InsertRoutineRunParams,
  RoutineRow,
  RoutineRunRow,
} from '../../port'
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

export const insertRoutineIn = async (params: { state: State; row: RoutineRow }): Promise<void> => {
  params.state.routines.set(params.row.routineId, { ...params.row })
}

export const updateRoutineIn = async (params: { state: State; row: RoutineRow }): Promise<void> => {
  params.state.routines.set(params.row.routineId, { ...params.row })
}

export const deleteRoutineIn = async (params: {
  state: State
  routineId: string
}): Promise<void> => {
  params.state.routines.delete(params.routineId)
  params.state.routineRuns = params.state.routineRuns.filter(
    (run) => run.routineId !== params.routineId,
  )
}

const byCreation = (left: RoutineRow, right: RoutineRow): number =>
  Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
  (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
  (left.routineId < right.routineId ? -1 : 1)

export const userRoutinesIn = (params: {
  state: State
  userId: string
  projectId?: string | undefined
}): RoutineRow[] =>
  [...params.state.routines.values()]
    .filter(
      (row) =>
        row.userId === params.userId &&
        (params.projectId === undefined || row.projectId === params.projectId),
    )
    .sort(byCreation)
    .map((row) => ({ ...row }))

export const userRoutineIn = (params: {
  state: State
  routineId: string
  userId: string
}): RoutineRow | undefined => {
  const row = params.state.routines.get(params.routineId)
  return row === undefined || row.userId !== params.userId ? undefined : { ...row }
}

const runRowOf = (run: InsertRoutineRunParams): RoutineRunRow => ({
  id: run.id,
  routineId: run.routineId,
  scheduledFor: run.scheduledFor,
  outcome: run.outcome,
  reason: run.reason ?? null,
  sessionId: run.sessionId ?? null,
  at: run.at,
})

const byNewest = (left: RoutineRunRow, right: RoutineRunRow): number =>
  Date.parse(right.at) - Date.parse(left.at) ||
  Date.parse(right.scheduledFor) - Date.parse(left.scheduledFor) ||
  (left.id < right.id ? 1 : -1)

export const routineRunsIn = (params: {
  state: State
  routineId: string
  limit: number
}): RoutineRunRow[] =>
  params.state.routineRuns
    .filter((run) => run.routineId === params.routineId)
    .map(runRowOf)
    .sort(byNewest)
    .slice(0, params.limit)
