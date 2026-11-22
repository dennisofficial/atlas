import { z } from 'zod'

import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export const POD_DISK_GROW_ONE_TASK_ID = 'pod-disk-grow-one'

export const podDiskGrowOnePayloadSchema = z.object({
  podSessionId: z.string().min(1),
  usedBytes: z.number().int().min(0),
  limitBytes: z.number().int().min(1),
  urgent: z.boolean(),
  waits: z.number().int().min(0).optional(),
})

export type PodDiskGrowOnePayload = z.infer<typeof podDiskGrowOnePayloadSchema>

export enum EPodDiskGrowOneOutcome {
  Grown = 'grown',
  Waiting = 'waiting',
  Superseded = 'superseded',
  Skipped = 'skipped',
}

export type PodDiskGrowOneOutput = {
  outcome: EPodDiskGrowOneOutcome
  diskGb?: number | undefined
}

export type PodDiskGrowOneTask = Task<
  typeof POD_DISK_GROW_ONE_TASK_ID,
  PodDiskGrowOnePayload,
  PodDiskGrowOneOutput
>

export const podDiskGrowOneTaskContract: TaskContract<PodDiskGrowOneTask> = {
  id: POD_DISK_GROW_ONE_TASK_ID,
  schema: podDiskGrowOnePayloadSchema,
}

export const POD_DISK_GROWN_LIFETIME_STEPS = 2

export const podDiskGrownNotice = (diskGb: number): string =>
  `The pod restarted to grow its disk to ${diskGb} GB. Files are kept. Running shells, services and the last command stopped; restart what you need.`

export const podDiskGrowOneIdempotencyKey = (args: {
  payload: PodDiskGrowOnePayload
  targetGb: number
}): string =>
  `${POD_DISK_GROW_ONE_TASK_ID}:${args.payload.podSessionId}:${args.targetGb}:${args.payload.urgent}:${args.payload.waits ?? 0}`
