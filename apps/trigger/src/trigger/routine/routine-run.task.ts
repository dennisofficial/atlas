import { randomUUID } from 'node:crypto'
import type { RunRoutineResult } from '@dltech/atlas-control'
import {
  ROUTINE_RUN_TASK_ID,
  type RoutineRunPayload,
  routineRunPayloadSchema,
} from '@dltech/atlas-jobs'
import { concurrencyLimit, schemaTask } from '@trigger.dev/sdk'
import '../init'
import { cronOf, nextOccurrenceFrom, nextRunAtAfterFailure, wedgedAfterMs } from './routine-cron'
import { buildRoutineGraph, type RoutineGraph } from './routine-graph'

export const ROUTINE_RUN_MAX_DURATION_SECONDS = 60

export const ROUTINE_RUN_MAX_ATTEMPTS = 3

export const ROUTINE_RUN_CONCURRENCY = 3

export const ROUTINE_RUN_CONCURRENCY_ID = 'routine-runs'

const FAILURE_REASON_LIMIT = 500

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const runRoutineOnce = async (params: {
  graph: RoutineGraph
  payload: RoutineRunPayload
  now: string
}): Promise<RunRoutineResult> => {
  const routine = await params.graph.store.transact((tx) =>
    tx.readRoutine(params.payload.routineId),
  )
  if (routine === undefined) return { outcome: 'skipped', reason: 'routine-not-found' }

  const cron = cronOf(routine.cron)

  return params.graph.plane.runRoutine({
    routineId: routine.routineId,
    scheduledFor: params.payload.scheduledFor,
    now: params.now,
    wedgedAfterMs: wedgedAfterMs(cron),
    nextOccurrence: ({ after }) => nextOccurrenceFrom({ cron, timezone: routine.timezone, after }),
    createSessionId: () => ({ sessionId: randomUUID(), mainThreadId: randomUUID() }),
  })
}

export const recordRoutineFailure = async (params: {
  graph: RoutineGraph
  payload: RoutineRunPayload
  error: unknown
  now: string
}): Promise<void> => {
  const reason = `failed: ${messageOf(params.error)}`.slice(0, FAILURE_REASON_LIMIT)

  await params.graph.store.transact(async (tx) => {
    const routine = await tx.readRoutine(params.payload.routineId)
    if (routine === undefined) return

    const nextRunAt = nextRunAtAfterFailure({
      cronExpression: routine.cron,
      timezone: routine.timezone,
      scheduledFor: params.payload.scheduledFor,
      now: params.now,
    })

    const advanced = await tx.advanceRoutine({
      routineId: routine.routineId,
      expectedNextRunAt: params.payload.scheduledFor,
      nextRunAt,
      at: params.now,
    })
    if (!advanced) return

    await tx.insertRoutineRun({
      id: randomUUID(),
      routineId: routine.routineId,
      scheduledFor: params.payload.scheduledFor,
      outcome: 'failed',
      reason,
      at: params.now,
    })
  })
}

export const routineRunTask = schemaTask({
  id: ROUTINE_RUN_TASK_ID,
  schema: routineRunPayloadSchema,
  maxDuration: ROUTINE_RUN_MAX_DURATION_SECONDS,
  retry: { maxAttempts: ROUTINE_RUN_MAX_ATTEMPTS },
  concurrency: concurrencyLimit({
    name: ROUTINE_RUN_CONCURRENCY_ID,
    total: ROUTINE_RUN_CONCURRENCY,
  }),
  run: async (payload) =>
    runRoutineOnce({ graph: buildRoutineGraph(), payload, now: new Date().toISOString() }),
  onFailure: async ({ payload, error }) => {
    await recordRoutineFailure({
      graph: buildRoutineGraph(),
      payload,
      error,
      now: new Date().toISOString(),
    })
  },
})
