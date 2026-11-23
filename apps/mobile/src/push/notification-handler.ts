import * as Notifications from 'expo-notifications'
import { AppState } from 'react-native'

import { presentedNotificationOf, readDismissalIdsOf, sessionIdOfData } from './notification-data'

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

const dismissAll = async (identifiers: readonly string[]): Promise<void> => {
  await Promise.all(
    identifiers.map((identifier) => Notifications.dismissNotificationAsync(identifier)),
  )
}

export const dismissPresentedForSession = async (sessionId: string): Promise<void> => {
  const presented = await Notifications.getPresentedNotificationsAsync()
  const matching = presented.filter(
    (notification) => sessionIdOfData(notification.request.content.data) === sessionId,
  )
  await dismissAll(matching.map((notification) => notification.request.identifier))
}

export const dismissPresentedRead = async (
  readSeqs: ReadonlyMap<string, number>,
): Promise<void> => {
  const presented = await Notifications.getPresentedNotificationsAsync()
  const entries = presented.flatMap((notification) => {
    const entry = presentedNotificationOf({
      identifier: notification.request.identifier,
      data: notification.request.content.data,
    })
    return entry === null ? [] : [entry]
  })
  await dismissAll(readDismissalIdsOf({ presented: entries, readSeqs }))
}

export const subscribeToNotificationResponses = ({
  onSessionId,
}: {
  onSessionId: (sessionId: string) => void
}): Notifications.EventSubscription =>
  Notifications.addNotificationResponseReceivedListener((response) => {
    const sessionId = sessionIdOfData(response.notification.request.content.data)
    if (sessionId !== undefined) onSessionId(sessionId)
  })
