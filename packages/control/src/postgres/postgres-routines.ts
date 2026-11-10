import { and, type Tx } from '@dltech/atlas-db'

import type { AdvanceRoutineParams, InsertRoutineRunParams, RoutineRow } from '../port'
import { toRoutineRow } from './postgres-rows'

export const lockRoutineIn = async (params: {
  tx: Tx
  routineId: string
}): Promise<RoutineRow | undefined> => {
  const row = await params.tx.orm.v2.V2Routine.where({ id: params.routineId })
    .forNoKeyUpdate()
    .first()
  return row === null ? undefined : toRoutineRow(row)
}

export const readRoutineIn = async (params: {
  tx: Tx
  routineId: string
}): Promise<RoutineRow | undefined> => {
  const row = await params.tx.orm.v2.V2Routine.first({ id: params.routineId })
  return row === null ? undefined : toRoutineRow(row)
}

export const advanceRoutineIn = async (
  params: AdvanceRoutineParams & { tx: Tx },
): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Routine.where({
    id: params.routineId,
    nextRunAt: new Date(params.expectedNextRunAt),
  }).updateAndCount({
    nextRunAt: new Date(params.nextRunAt),
    updatedAt: new Date(params.at),
    ...(params.lastRunAt === undefined ? {} : { lastRunAt: new Date(params.lastRunAt) }),
    ...(params.lastSessionId === undefined ? {} : { lastSessionId: params.lastSessionId }),
  })
  return changed === 1
}

export const insertRoutineRunIn = async (
  params: InsertRoutineRunParams & { tx: Tx },
): Promise<void> => {
  await params.tx.orm.v2.V2RoutineRun.create({
    id: params.id,
    routineId: params.routineId,
    scheduledFor: new Date(params.scheduledFor),
    outcome: params.outcome,
    reason: params.reason ?? null,
    sessionId: params.sessionId ?? null,
    at: new Date(params.at),
  })
}

export const dueRoutinesIn = async (params: {
  tx: Tx
  now: string
  limit: number
}): Promise<RoutineRow[]> => {
  const rows = await params.tx.orm.v2.V2Routine.where((routine) =>
    and(routine.enabled.eq(true), routine.nextRunAt.lte(new Date(params.now))),
  )
    .orderBy((routine) => routine.nextRunAt.asc())
    .limit(params.limit)
    .all()
  return rows.map(toRoutineRow)
}
