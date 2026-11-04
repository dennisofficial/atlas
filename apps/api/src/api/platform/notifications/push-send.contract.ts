import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const PUSH_SEND_TASK_ID = 'push-send'

export const pushMessageSchema = z.strictObject({
  to: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string(), z.string()).optional(),
})

export const pushSendPayloadSchema = z.strictObject({
  messages: z.array(pushMessageSchema).min(1).max(100),
})

export type PushSendPayload = z.infer<typeof pushSendPayloadSchema>

export type PushSendOutput = { sent: number; pruned: number }

export type PushSendTask = Task<typeof PUSH_SEND_TASK_ID, PushSendPayload, PushSendOutput>

export const pushSendTaskContract: TaskContract<PushSendTask> = {
  id: PUSH_SEND_TASK_ID,
  schema: pushSendPayloadSchema,
}
