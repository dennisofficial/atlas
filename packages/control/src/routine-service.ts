import { randomUUID } from 'node:crypto'

import { EMessageOrigin } from '@dltech/atlas-core'
import {
  INBOX_KIND_MESSAGE,
  type Routine,
  type RoutineCreateInput,
  type RoutineListOutput,
  type RoutineRunOutput,
  type RoutineRunRow,
  type RoutineRunsOutput,
  type RoutineUpdateInput,
} from '@dltech/atlas-protocol'
import {
  type Cron,
  CronNeverFiresError,
  minimumGapMinutes,
  nextOccurrenceAfter,
  parseCron,
} from '@dltech/atlas-schedule'

import type { ControlPlane } from './control-plane'
import { derivedIdOf } from './derived-id'
import type { RoutinePatch } from './routine-crud'
import type { RoutineRow, RoutineRunRow as ControlRoutineRunRow } from './routine-rows'

export const MINIMUM_ROUTINE_GAP_MINUTES = 5

export class RoutineInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutineInvalidError'
  }
}

export class RoutineNotFoundError extends Error {
  constructor(routineId: string) {
    super(`routine not found: ${routineId}`)
    this.name = 'RoutineNotFoundError'
  }
}

export type RoutinePlane = Pick<
  ControlPlane,
  | 'createRoutine'
  | 'createSessionWithMessage'
  | 'deleteRoutine'
  | 'listRoutineRuns'
  | 'listRoutines'
  | 'readRoutine'
  | 'readSession'
  | 'updateRoutine'
>

export type RoutinesFor = {
  plane: RoutinePlane
  userId: string
  projectId?: string | undefined
}

const knownTimezone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new RoutineInvalidError(`unknown timezone: ${timezone}`)
  }
}

const checkedCron = ({ cron, timezone }: { cron: string; timezone: string }): Cron => {
  const parsed = parseCron(cron)
  if (!parsed.ok) throw new RoutineInvalidError(`cron: ${parsed.reason}`)
  knownTimezone(timezone)
  if (minimumGapMinutes(parsed.cron) < MINIMUM_ROUTINE_GAP_MINUTES) {
    throw new RoutineInvalidError(
      `a routine runs at most every ${MINIMUM_ROUTINE_GAP_MINUTES} minutes`,
    )
  }
  return parsed.cron
}

const nextRunOf = ({
  cron,
  timezone,
  after,
}: {
  cron: Cron
  timezone: string
  after: Date
}): string => {
  try {
    return nextOccurrenceAfter({ cron, after, timezone }).toISOString()
  } catch (failure) {
    if (failure instanceof CronNeverFiresError) throw new RoutineInvalidError(failure.message)
    throw failure
  }
}

export const routineOf = (row: RoutineRow): Routine => ({
  routineId: row.routineId,
  projectId: row.projectId,
  name: row.name,
  prompt: row.prompt,
  cron: row.cron,
  timezone: row.timezone,
  enabled: row.enabled,
  model: row.modelRef,
  effort: row.modelEffort,
  fast: row.modelFast,
  nextRunAt: row.nextRunAt,
  lastRunAt: row.lastRunAt,
  lastSessionId: row.lastSessionId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const runOf = (row: ControlRoutineRunRow): RoutineRunRow => ({
  runId: row.id,
  scheduledFor: row.scheduledFor,
  outcome: row.outcome,
  reason: row.reason,
  sessionId: row.sessionId,
  at: row.at,
})

const routineIn = async (args: RoutinesFor & { routineId: string }): Promise<RoutineRow> => {
  const row = await args.plane.readRoutine({ routineId: args.routineId, userId: args.userId })
  if (row === undefined) throw new RoutineNotFoundError(args.routineId)
  if (args.projectId !== undefined && row.projectId !== args.projectId) {
    throw new RoutineNotFoundError(args.routineId)
  }
  return row
}

export const routineListOf = async (scope: RoutinesFor): Promise<RoutineListOutput> => {
  const rows = await scope.plane.listRoutines({ userId: scope.userId, projectId: scope.projectId })
  return { routines: rows.map(routineOf) }
}

export const routineGetOf = async (args: RoutinesFor & { routineId: string }): Promise<Routine> =>
  routineOf(await routineIn(args))

export const routineCreateOf = async (
  args: {
    userId: string
    input: RoutineCreateInput
    idempotencyKey?: string | undefined
  } & { plane: RoutinePlane },
): Promise<Routine> => {
  const cron = checkedCron({ cron: args.input.cron, timezone: args.input.timezone })
  const now = new Date()
  const at = now.toISOString()
  const routineId =
    args.idempotencyKey === undefined ? randomUUID() : derivedIdOf(`routine:${args.idempotencyKey}`)
  const existing =
    args.idempotencyKey === undefined
      ? undefined
      : await args.plane.readRoutine({ routineId, userId: args.userId })
  if (existing !== undefined) {
    if (existing.projectId !== args.input.projectId) {
      throw new RoutineInvalidError(
        `the routine ${routineId} this call already created belongs to another project`,
      )
    }
    return routineOf(existing)
  }
  const row: RoutineRow = {
    routineId,
    userId: args.userId,
    projectId: args.input.projectId,
    name: args.input.name,
    prompt: args.input.prompt,
    cron: args.input.cron,
    timezone: args.input.timezone,
    enabled: args.input.enabled ?? true,
    modelRef: args.input.model ?? null,
    modelEffort: args.input.effort ?? null,
    modelFast: args.input.fast ?? null,
    nextRunAt: nextRunOf({ cron, timezone: args.input.timezone, after: now }),
    lastRunAt: null,
    lastSessionId: null,
    createdAt: at,
    updatedAt: at,
  }
  await args.plane.createRoutine(row)
  return routineOf(row)
}

export const routineUpdateOf = async (
  args: RoutinesFor & { input: RoutineUpdateInput },
): Promise<Routine> => {
  const row = await routineIn({ ...args, routineId: args.input.routineId })
  const cron = args.input.cron ?? row.cron
  const timezone = args.input.timezone ?? row.timezone
  const rescheduled = args.input.cron !== undefined || args.input.timezone !== undefined
  const enabling = args.input.enabled === true && !row.enabled
  const parsed = checkedCron({ cron, timezone })
  const at = new Date().toISOString()
  const patch: RoutinePatch = {
    ...(args.input.name === undefined ? {} : { name: args.input.name }),
    ...(args.input.prompt === undefined ? {} : { prompt: args.input.prompt }),
    ...(args.input.cron === undefined ? {} : { cron: args.input.cron }),
    ...(args.input.timezone === undefined ? {} : { timezone: args.input.timezone }),
    ...(args.input.enabled === undefined ? {} : { enabled: args.input.enabled }),
    ...(args.input.model === undefined ? {} : { modelRef: args.input.model }),
    ...(args.input.effort === undefined ? {} : { modelEffort: args.input.effort }),
    ...(args.input.fast === undefined ? {} : { modelFast: args.input.fast }),
  }
  const changed = await args.plane.updateRoutine({
    routineId: row.routineId,
    userId: args.userId,
    patch,
    ...(rescheduled || enabling
      ? { nextRunAt: nextRunOf({ cron: parsed, timezone, after: new Date(at) }) }
      : {}),
    at,
  })
  if (changed === undefined) throw new RoutineNotFoundError(row.routineId)
  return routineOf(changed)
}

export const routineRemoveOf = async (args: {
  plane: RoutinePlane
  userId: string
  routineId: string
  projectId?: string | undefined
}): Promise<{ removed: boolean }> => {
  if (args.projectId !== undefined) {
    const row = await args.plane.readRoutine({ routineId: args.routineId, userId: args.userId })
    if (row === undefined || row.projectId !== args.projectId) return { removed: false }
  }
  const removed = await args.plane.deleteRoutine({
    routineId: args.routineId,
    userId: args.userId,
  })
  return { removed }
}

export const routineRunsOf = async (
  args: RoutinesFor & { routineId: string; limit?: number | undefined },
): Promise<RoutineRunsOutput> => {
  await routineIn({ ...args, routineId: args.routineId })
  const rows = await args.plane.listRoutineRuns({
    routineId: args.routineId,
    limit: args.limit ?? 20,
  })
  return { runs: rows.map(runOf) }
}

export const routineRunNowOf = async (
  args: RoutinesFor & { routineId: string; idempotencyKey?: string | undefined },
): Promise<RoutineRunOutput> => {
  const row = await routineIn({ ...args, routineId: args.routineId })
  const sessionId =
    args.idempotencyKey === undefined
      ? randomUUID()
      : derivedIdOf(`routine-run:${args.idempotencyKey}`)
  if (args.idempotencyKey !== undefined) {
    const existing = await args.plane.readSession({ sessionId })
    if (existing !== undefined) {
      if (existing.userId !== args.userId) {
        throw new RoutineInvalidError(
          `the session ${sessionId} this call already started belongs to another user`,
        )
      }
      return { sessionId }
    }
  }
  await args.plane.createSessionWithMessage({
    sessionId,
    mainThreadId:
      args.idempotencyKey === undefined
        ? randomUUID()
        : derivedIdOf(`routine-run-thread:${args.idempotencyKey}`),
    userId: args.userId,
    projectId: row.projectId,
    title: row.name,
    model: {
      ref: row.modelRef ?? undefined,
      effort: row.modelEffort ?? undefined,
      fast: row.modelFast ?? undefined,
    },
    routineId: row.routineId,
    message: {
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: row.prompt, via: EMessageOrigin.Routine }),
    },
  })
  return { sessionId }
}
