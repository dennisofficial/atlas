import {
  POD_SLEEP_TASK_ID,
  podSleepPayloadSchema,
  type PodSleepOutput,
  type PodSleepPayload,
} from '@dltech/atlas-jobs/pod-sleep'

import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export * from '@dltech/atlas-jobs/pod-sleep'

export type PodSleepTask = Task<typeof POD_SLEEP_TASK_ID, PodSleepPayload, PodSleepOutput>

export const podSleepTaskContract: TaskContract<PodSleepTask> = {
  id: POD_SLEEP_TASK_ID,
  schema: podSleepPayloadSchema,
}
