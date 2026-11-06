import { z } from 'zod'

import { ERetryReason } from '../models/retry'
import type { V2Event } from './event'

export const retryScheduledSchema = z.object({
  type: z.literal('retry-scheduled'),
  key: z.string().min(1),
  notBefore: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  attempt: z.number().int().min(1),
  reason: z.enum(ERetryReason),
})

export type RetryScheduled = z.infer<typeof retryScheduledSchema>

export type ScheduledRetry = Omit<RetryScheduled, 'type'>

export const retryDeadlineAfter = (params: {
  event: V2Event
  nowMs: number
}): string | undefined => {
  const { event, nowMs } = params
  if (event.type !== 'retry-scheduled') return undefined
  return Date.parse(event.notBefore) > nowMs ? event.notBefore : undefined
}
