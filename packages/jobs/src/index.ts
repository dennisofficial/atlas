import { z } from 'zod'

export const HEARTBEAT_TASK_ID = 'heartbeat'

export const heartbeatPayloadSchema = z.strictObject({})

export const heartbeatOutputSchema = z.object({
  taskId: z.literal(HEARTBEAT_TASK_ID),
  databaseUrlPresent: z.boolean(),
})

export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>

export type HeartbeatOutput = z.infer<typeof heartbeatOutputSchema>
