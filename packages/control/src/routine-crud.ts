import type { ControlTx, RoutineRow } from './port'

export type RoutinePatch = {
  name?: string | undefined
  prompt?: string | undefined
  cron?: string | undefined
  timezone?: string | undefined
  enabled?: boolean | undefined
  modelRef?: string | null | undefined
  modelEffort?: string | null | undefined
  modelFast?: boolean | null | undefined
}

const patched = (
  row: RoutineRow,
  patch: RoutinePatch,
  at: string,
  nextRunAt: string,
): RoutineRow => ({
  ...row,
  ...(patch.name === undefined ? {} : { name: patch.name }),
  ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
  ...(patch.cron === undefined ? {} : { cron: patch.cron }),
  ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
  ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
  ...(patch.modelRef === undefined ? {} : { modelRef: patch.modelRef }),
  ...(patch.modelEffort === undefined ? {} : { modelEffort: patch.modelEffort }),
  ...(patch.modelFast === undefined ? {} : { modelFast: patch.modelFast }),
  nextRunAt,
  updatedAt: at,
})

export const createRoutineIn = async (params: {
  tx: ControlTx
  row: RoutineRow
}): Promise<RoutineRow> => {
  await params.tx.insertRoutine(params.row)
  return params.row
}

export const updateRoutineIn = async (params: {
  tx: ControlTx
  routineId: string
  userId: string
  patch: RoutinePatch
  nextRunAt?: string | undefined
  at: string
}): Promise<RoutineRow | undefined> => {
  const routine = await params.tx.lockRoutine(params.routineId)
  if (routine === undefined || routine.userId !== params.userId) return undefined
  const row = patched(routine, params.patch, params.at, params.nextRunAt ?? routine.nextRunAt)
  await params.tx.updateRoutine(row)
  return row
}

export const deleteRoutineIn = async (params: {
  tx: ControlTx
  routineId: string
  userId: string
}): Promise<boolean> => {
  const routine = await params.tx.lockRoutine(params.routineId)
  if (routine === undefined || routine.userId !== params.userId) return false
  await params.tx.deleteRoutine(params.routineId)
  return true
}
