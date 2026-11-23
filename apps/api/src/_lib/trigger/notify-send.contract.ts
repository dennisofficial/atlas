import {
  NOTIFY_SEND_TASK_ID,
  NOTIFY_TEST_TASK_ID,
  notifySendPayloadSchema,
  notifyTestPayloadSchema,
  type NotifySendOutput,
  type NotifySendPayload,
  type NotifyTestPayload,
} from '@dltech/atlas-jobs/notify'

import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export * from '@dltech/atlas-jobs/notify'

export type NotifySendTask = Task<typeof NOTIFY_SEND_TASK_ID, NotifySendPayload, NotifySendOutput>

export type NotifyTestTask = Task<typeof NOTIFY_TEST_TASK_ID, NotifyTestPayload, NotifySendOutput>

export const notifySendTaskContract: TaskContract<NotifySendTask> = {
  id: NOTIFY_SEND_TASK_ID,
  schema: notifySendPayloadSchema,
}

export const notifyTestTaskContract: TaskContract<NotifyTestTask> = {
  id: NOTIFY_TEST_TASK_ID,
  schema: notifyTestPayloadSchema,
}
