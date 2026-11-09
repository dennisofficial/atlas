import * as Notifications from 'expo-notifications'
import { AppState } from 'react-native'

export const installNotificationHandler = (): void => {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const onScreen = AppState.currentState === 'active'
      return {
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: !onScreen,
        shouldShowList: !onScreen,
      }
    },
  })
}

const threadIdOfNotification = (request: Notifications.NotificationRequest): string | undefined => {
  const value = request.content.data?.threadId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const dismissPresentedForThread = async (threadId: string): Promise<void> => {
  const presented = await Notifications.getPresentedNotificationsAsync()
  const matching = presented.filter(
    (notification) => threadIdOfNotification(notification.request) === threadId,
  )
  await Promise.all(
    matching.map((notification) =>
      Notifications.dismissNotificationAsync(notification.request.identifier),
    ),
  )
}

export const subscribeToNotificationResponses = ({
  onThreadId,
}: {
  onThreadId: (threadId: string) => void
}): Notifications.EventSubscription =>
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data: unknown = response.notification.request.content.data
    if (typeof data === 'object' && data !== null && 'threadId' in data) {
      const threadId = data.threadId
      if (typeof threadId === 'string' && threadId.length > 0) onThreadId(threadId)
    }
  })
