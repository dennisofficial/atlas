import { z } from 'zod'

export const HEARTBEAT_TASK_ID = 'heartbeat'

export const ROUTINE_SWEEP_TASK_ID = 'routine-sweep'

export const ROUTINE_RUN_TASK_ID = 'routine-run'

export const routineSweepPayloadSchema = z.strictObject({})

export const routineRunPayloadSchema = z.strictObject({
  routineId: z.string().min(1),
  scheduledFor: z.iso.datetime(),
})

export const heartbeatPayloadSchema = z.strictObject({})

export const heartbeatOutputSchema = z.object({
  taskId: z.literal(HEARTBEAT_TASK_ID),
  databaseUrlPresent: z.boolean(),
})

export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>

export type HeartbeatOutput = z.infer<typeof heartbeatOutputSchema>

export type RoutineSweepPayload = z.infer<typeof routineSweepPayloadSchema>

export type RoutineRunPayload = z.infer<typeof routineRunPayloadSchema>

export const routineRunIdempotencyKey = (payload: RoutineRunPayload): string =>
  `routine:${payload.routineId}:${payload.scheduledFor}`
