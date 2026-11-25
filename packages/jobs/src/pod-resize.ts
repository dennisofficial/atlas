import { z } from 'zod'

export const POD_RESIZE_TASK_ID = 'pod-resize'

export const POD_RESIZE_MAX_DISK_GB = 100

export const podResizePayloadSchema = z.object({
  sessionId: z.string().min(1),
  generation: z.number().int().min(1),
  vcpus: z.number().int().min(1),
  memoryGb: z.number().int().min(1),
  diskGb: z.number().int().min(1).max(POD_RESIZE_MAX_DISK_GB).optional(),
  whenIdle: z.boolean().optional(),
  waitedSince: z.string().min(1).optional(),
})

export type PodResizePayload = z.infer<typeof podResizePayloadSchema>

export enum EPodResizeOutcome {
  Applied = 'applied',
  Stored = 'stored',
  Superseded = 'superseded',
  Failed = 'failed',
  Deferred = 'deferred',
  Waiting = 'waiting',
}

export type PodResizeOutput = { outcome: EPodResizeOutcome }

export const podResizeIdempotencyKey = (payload: PodResizePayload): string =>
  payload.waitedSince === undefined
    ? `pod-resize:${payload.sessionId}:${payload.generation}`
    : `pod-resize:${payload.sessionId}:${payload.generation}:idle:${payload.waitedSince}`
