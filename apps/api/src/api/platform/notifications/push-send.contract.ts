import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const PUSH_SEND_TASK_ID = 'push-send'

const carriesAlert = (message: {
  title?: string | undefined
  body?: string | undefined
  contentAvailable?: true | undefined
}): boolean =>
  message.contentAvailable === true || (message.title !== undefined && message.body !== undefined)

// On iOS collapseId replaces the notification already on the device and threadId groups
// them (https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format).
export const pushMessageSchema = z
  .strictObject({
    to: z.string().min(1),
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    data: z.record(z.string(), z.string()).optional(),
    collapseId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
    contentAvailable: z.literal(true).optional(),
    priority: z.enum(['default', 'normal', 'high']).optional(),
  })
  .refine(carriesAlert, {
    message: 'a push message carries a title and body, or contentAvailable: true',
  })

export const pushSendPayloadSchema = z.strictObject({
  messages: z.array(pushMessageSchema).min(1).max(100),
})

export type PushMessage = z.infer<typeof pushMessageSchema>
export type PushSendPayload = z.infer<typeof pushSendPayloadSchema>

export type PushSendOutput = { sent: number; pruned: number }

export type PushSendTask = Task<typeof PUSH_SEND_TASK_ID, PushSendPayload, PushSendOutput>

export const pushSendTaskContract: TaskContract<PushSendTask> = {
  id: PUSH_SEND_TASK_ID,
  schema: pushSendPayloadSchema,
}
