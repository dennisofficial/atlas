import * as Notifications from 'expo-notifications'

export const installNotificationHandler = (): void => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
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
