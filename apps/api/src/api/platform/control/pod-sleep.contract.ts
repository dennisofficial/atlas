import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const POD_SLEEP_TASK_ID = 'pod-sleep'

export const podSleepPayloadSchema = z.object({
  sessionId: z.string().min(1),
  epoch: z.number().int().min(0),
})

export type PodSleepPayload = z.infer<typeof podSleepPayloadSchema>

export enum EPodSleepOutcome {
  Slept = 'slept',
  Absent = 'absent',
}

export type PodSleepOutput = { outcome: EPodSleepOutcome }

export type PodSleepTask = Task<typeof POD_SLEEP_TASK_ID, PodSleepPayload, PodSleepOutput>

export const podSleepTaskContract: TaskContract<PodSleepTask> = {
  id: POD_SLEEP_TASK_ID,
  schema: podSleepPayloadSchema,
}

export const podSleepIdempotencyKey = (payload: PodSleepPayload): string =>
  `pod-sleep:${payload.sessionId}:${payload.epoch}`
