import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const POD_RESIZE_TASK_ID = 'pod-resize'

export const podResizePayloadSchema = z.object({
  sessionId: z.string().min(1),
  generation: z.number().int().min(1),
  vcpus: z.number().int().min(1),
})

export type PodResizePayload = z.infer<typeof podResizePayloadSchema>

export enum EPodResizeOutcome {
  Applied = 'applied',
  Stored = 'stored',
  Superseded = 'superseded',
}

export type PodResizeOutput = { outcome: EPodResizeOutcome }

export type PodResizeTask = Task<typeof POD_RESIZE_TASK_ID, PodResizePayload, PodResizeOutput>

export const podResizeTaskContract: TaskContract<PodResizeTask> = {
  id: POD_RESIZE_TASK_ID,
  schema: podResizePayloadSchema,
}

export const podResizeIdempotencyKey = (payload: PodResizePayload): string =>
  `pod-resize:${payload.sessionId}:${payload.generation}`
