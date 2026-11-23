import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'

import { clearSessionIdOf } from './dismiss-payload'
import { dismissPresentedForSession } from './notification-handler'

export const BACKGROUND_NOTIFICATION_TASK = 'atlas-background-notification'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error !== undefined) return Notifications.BackgroundNotificationTaskResult.Failed
    const sessionId = clearSessionIdOf(data)
    if (sessionId === undefined) return Notifications.BackgroundNotificationTaskResult.NoData
    await dismissPresentedForSession(sessionId)
    return Notifications.BackgroundNotificationTaskResult.NewData
  },
)

export const installBackgroundNotifications = (): void => {
  void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined)
}
