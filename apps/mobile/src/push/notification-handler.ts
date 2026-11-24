import * as Notifications from 'expo-notifications'
import { AppState } from 'react-native'

import { presentedNotificationOf, readDismissalIdsOf, sessionIdOfData } from './notification-data'
import type { TNotificationTap } from './session-tap'

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
  onTap,
  onResponse,
}: {
  onTap: (tap: TNotificationTap) => void
  onResponse?: ((response: Notifications.NotificationResponse) => void) | undefined
}): Notifications.EventSubscription =>
  Notifications.addNotificationResponseReceivedListener((response) => {
    onResponse?.(response)
    onTap({
      identifier: response.notification.request.identifier,
      data: response.notification.request.content.data,
      actionIdentifier: response.actionIdentifier,
    })
  })

export const lastNotificationTap = (): TNotificationTap | undefined => {
  try {
    const response = Notifications.getLastNotificationResponse()
    if (response === null) return undefined
    return {
      identifier: response.notification.request.identifier,
      data: response.notification.request.content.data,
      actionIdentifier: response.actionIdentifier,
    }
  } catch {
    return undefined
  }
}
