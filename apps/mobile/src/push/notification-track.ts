import type { ApiClient } from '@dltech/atlas-api-router'
import { ENotifyDeviceKind, type AtlasNotification } from '@dltech/atlas-core'
import { NOTIFY_CATEGORY_ID } from '@dltech/atlas-notifications'
import * as Notifications from 'expo-notifications'

import { notificationTrackOf, trackDataOf, trackEventOfAction } from './notification-data'

export const installNotificationCategory = async (): Promise<void> => {
  await Notifications.setNotificationCategoryAsync(NOTIFY_CATEGORY_ID, [], {
    customDismissAction: true,
  }).catch(() => undefined)
}

export const reportNotificationResponse = async (args: {
  client: ApiClient | undefined
  actionIdentifier: string
  data: unknown
}): Promise<void> => {
  if (args.client === undefined) return
  const event = trackEventOfAction(args.actionIdentifier)
  if (event === null) return
  const track = trackDataOf(args.data)
  if (track === null) return
  await args.client.notifications.track
    .mutate({
      event,
      sessionId: track.sessionId,
      seq: track.seq,
      moment: track.moment,
      deviceKind: ENotifyDeviceKind.Expo,
      ...(track.sentAt === undefined ? {} : { sentAt: track.sentAt }),
    })
    .catch(() => undefined)
}

export const reportInAppShown = async (args: {
  client: ApiClient | undefined
  notice: AtlasNotification
}): Promise<void> => {
  if (args.client === undefined) return
  await args.client.notifications.track
    .mutate(notificationTrackOf(args.notice))
    .catch(() => undefined)
}
