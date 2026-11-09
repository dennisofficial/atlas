import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'

import { dismissThreadIdOf } from './dismiss-payload'
import { dismissPresentedForThread } from './notification-handler'

export const BACKGROUND_NOTIFICATION_TASK = 'atlas-background-notification'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error !== undefined) return Notifications.BackgroundNotificationTaskResult.Failed
    const threadId = dismissThreadIdOf(data)
    if (threadId === undefined) return Notifications.BackgroundNotificationTaskResult.NoData
    await dismissPresentedForThread(threadId)
    return Notifications.BackgroundNotificationTaskResult.NewData
  },
)

export const installBackgroundNotifications = (): void => {
  void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined)
}
