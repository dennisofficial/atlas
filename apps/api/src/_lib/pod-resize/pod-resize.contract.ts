import {
  POD_RESIZE_TASK_ID,
  podResizePayloadSchema,
  type PodResizeOutput,
  type PodResizePayload,
} from '@dltech/atlas-jobs/pod-resize'

import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export * from '@dltech/atlas-jobs/pod-resize'

export type PodResizeTask = Task<typeof POD_RESIZE_TASK_ID, PodResizePayload, PodResizeOutput>

export const podResizeTaskContract: TaskContract<PodResizeTask> = {
  id: POD_RESIZE_TASK_ID,
  schema: podResizePayloadSchema,
}
