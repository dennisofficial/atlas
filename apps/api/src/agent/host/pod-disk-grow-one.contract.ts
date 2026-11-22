import {
  POD_DISK_GROW_ONE_TASK_ID,
  podDiskGrowOnePayloadSchema,
  type PodDiskGrowOneOutput,
  type PodDiskGrowOnePayload,
} from '@dltech/atlas-jobs/pod-disk-grow-one'

import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export * from '@dltech/atlas-jobs/pod-disk-grow-one'

export type PodDiskGrowOneTask = Task<
  typeof POD_DISK_GROW_ONE_TASK_ID,
  PodDiskGrowOnePayload,
  PodDiskGrowOneOutput
>

export const podDiskGrowOneTaskContract: TaskContract<PodDiskGrowOneTask> = {
  id: POD_DISK_GROW_ONE_TASK_ID,
  schema: podDiskGrowOnePayloadSchema,
}
