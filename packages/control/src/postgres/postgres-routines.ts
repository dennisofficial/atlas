import { and, type Tx } from '@dltech/atlas-db'

import type {
  AdvanceRoutineParams,
  InsertRoutineRunParams,
  RoutineRow,
  RoutineRunRow,
} from '../port'
import { fromRoutineRow, toRoutineRow, toRoutineRunRow } from './postgres-rows'

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

export const insertRoutineIn = async (params: { tx: Tx; row: RoutineRow }): Promise<void> => {
  await params.tx.orm.v2.V2Routine.create(fromRoutineRow(params.row))
}

export const updateRoutineIn = async (params: { tx: Tx; row: RoutineRow }): Promise<void> => {
  await params.tx.orm.v2.V2Routine.where({ id: params.row.routineId }).update(
    fromRoutineRow(params.row),
  )
}

export const deleteRoutineIn = async (params: { tx: Tx; routineId: string }): Promise<void> => {
  await params.tx.orm.v2.V2RoutineRun.where({ routineId: params.routineId }).deleteAll()
  await params.tx.orm.v2.V2Routine.where({ id: params.routineId }).delete()
}

export const userRoutinesIn = async (params: {
  tx: Tx
  userId: string
  projectId?: string | undefined
}): Promise<RoutineRow[]> => {
  const rows = await params.tx.orm.v2.V2Routine.where((routine) =>
    params.projectId === undefined
      ? routine.userId.eq(params.userId)
      : and(routine.userId.eq(params.userId), routine.projectId.eq(params.projectId)),
  )
    .orderBy([(routine) => routine.createdAt.asc(), (routine) => routine.name.asc()])
    .all()
  return rows.map(toRoutineRow)
}

export const userRoutineIn = async (params: {
  tx: Tx
  routineId: string
  userId: string
}): Promise<RoutineRow | undefined> => {
  const row = await params.tx.orm.v2.V2Routine.first({
    id: params.routineId,
    userId: params.userId,
  })
  return row === null ? undefined : toRoutineRow(row)
}

export const routineRunsIn = async (params: {
  tx: Tx
  routineId: string
  limit: number
}): Promise<RoutineRunRow[]> => {
  const rows = await params.tx.orm.v2.V2RoutineRun.where({ routineId: params.routineId })
    .orderBy([(run) => run.at.desc(), (run) => run.id.desc()])
    .limit(params.limit)
    .all()
  return rows.map(toRoutineRunRow)
}
