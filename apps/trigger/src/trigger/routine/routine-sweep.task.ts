import {
  routineRunIdempotencyKey,
  ROUTINE_RUN_TASK_ID,
  ROUTINE_SWEEP_TASK_ID,
  routineRunPayloadSchema,
} from '@dltech/atlas-jobs'
import { schedules, tasks } from '@trigger.dev/sdk'
import '../init'
import { buildRoutineGraph, type RoutineGraph } from './routine-graph'

export const ROUTINE_SWEEP_CRON = '*/1 * * * *'

export const ROUTINE_SWEEP_LIMIT = 50

export type RoutineSweepOutput = { dispatched: number }

export const runRoutineSweep = async (params: {
  graph: RoutineGraph
  now: string
}): Promise<RoutineSweepOutput> => {
  const due = await params.graph.store.listDueRoutines({
    now: params.now,
    limit: ROUTINE_SWEEP_LIMIT,
  })
  const items = due.map((row) => {
    const payload = routineRunPayloadSchema.parse({
      routineId: row.routineId,
      scheduledFor: row.nextRunAt,
    })

    return { payload, options: { idempotencyKey: routineRunIdempotencyKey(payload) } }
  })

  if (items.length > 0) await tasks.batchTrigger(ROUTINE_RUN_TASK_ID, items)

  const output: RoutineSweepOutput = { dispatched: items.length }

  console.log(JSON.stringify(output))

  return output
}

export const routineSweepTask = schedules.task({
  id: ROUTINE_SWEEP_TASK_ID,
  cron: ROUTINE_SWEEP_CRON,
  run: async () => runRoutineSweep({ graph: buildRoutineGraph(), now: new Date().toISOString() }),
})
