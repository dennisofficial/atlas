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

const fieldOf = (
  request: Notifications.NotificationRequest,
  field: 'threadId' | 'sessionId',
): string | undefined => {
  const value = request.content.data?.[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const dismissPresentedForThread = async (threadId: string): Promise<void> => {
  const presented = await Notifications.getPresentedNotificationsAsync()
  const matching = presented.filter(
    (notification) => fieldOf(notification.request, 'threadId') === threadId,
  )
  await Promise.all(
    matching.map((notification) =>
      Notifications.dismissNotificationAsync(notification.request.identifier),
    ),
  )
}

export const subscribeToNotificationResponses = ({
  onSessionId,
}: {
  onSessionId: (sessionId: string) => void
}): Notifications.EventSubscription =>
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data: unknown = response.notification.request.content.data
    if (typeof data === 'object' && data !== null && 'sessionId' in data) {
      const sessionId = data.sessionId
      if (typeof sessionId === 'string' && sessionId.length > 0) onSessionId(sessionId)
    }
  })
