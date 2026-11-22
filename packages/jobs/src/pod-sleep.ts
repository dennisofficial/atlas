import { z } from 'zod'

export const POD_SLEEP_TASK_ID = 'pod-sleep'

export const podSleepPayloadSchema = z.object({
  sessionId: z.string().min(1),
  epoch: z.number().int().min(0),
})

export type PodSleepPayload = z.infer<typeof podSleepPayloadSchema>

export enum EPodSleepOutcome {
  Slept = 'slept',
  Absent = 'absent',
  Superseded = 'superseded',
}

export type PodSleepOutput = { outcome: EPodSleepOutcome }

export const podSleepIdempotencyKey = (payload: PodSleepPayload): string =>
  `pod-sleep:${payload.sessionId}:${payload.epoch}`
