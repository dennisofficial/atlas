import {
  NOTIFY_CLEAR_TASK_ID,
  notifyClearPayloadSchema,
  type NotifyClearPayload,
  type NotifySendOutput,
} from '@dltech/atlas-jobs/notify'

import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export * from '@dltech/atlas-jobs/notify'

export type NotifyClearTask = Task<
  typeof NOTIFY_CLEAR_TASK_ID,
  NotifyClearPayload,
  NotifySendOutput
>

export const notifyClearTaskContract: TaskContract<NotifyClearTask> = {
  id: NOTIFY_CLEAR_TASK_ID,
  schema: notifyClearPayloadSchema,
}
