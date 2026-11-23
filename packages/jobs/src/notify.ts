import { ENotifyMoment } from '@dltech/atlas-core'
import { z } from 'zod'

export const NOTIFY_SEND_TASK_ID = 'notify-send'

export const NOTIFY_TEST_TASK_ID = 'notify-test'

export const notifySendPayloadSchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  moment: z.enum(ENotifyMoment),
})

export const notifyTestPayloadSchema = z.object({
  userId: z.string().min(1),
})

export type NotifySendPayload = z.infer<typeof notifySendPayloadSchema>

export type NotifyTestPayload = z.infer<typeof notifyTestPayloadSchema>

export type NotifySendOutput = { sent: number; gone: number }

export const NO_NOTIFY_OUTPUT: NotifySendOutput = { sent: 0, gone: 0 }

export const notifySendIdempotencyKey = (payload: NotifySendPayload): string =>
  `notify:${payload.sessionId}:${payload.seq}`

export const NOTIFY_TEST_WINDOW_MS = 60_000

export const notifyTestIdempotencyKey = (args: {
  payload: NotifyTestPayload
  now: string
}): string =>
  `notify-test:${args.payload.userId}:${Math.floor(Date.parse(args.now) / NOTIFY_TEST_WINDOW_MS)}`
