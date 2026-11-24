import {
  ENotifyInAppKind,
  ENotifyMoment,
  ENotifyTrackEvent,
  type AtlasNotification,
} from '@dltech/atlas-core'
import {
  NOTIFY_DATA_MOMENT_KEY,
  NOTIFY_DATA_ROUTINE_KEY,
  NOTIFY_DATA_SENT_AT_KEY,
  NOTIFY_DATA_SEQ_KEY,
  NOTIFY_DATA_SESSION_KEY,
} from '@dltech/atlas-notifications'
import { z } from 'zod'

import { NOTIFICATION_DISMISS_ACTION, NOTIFICATION_OPEN_ACTION } from './action-identifiers'

const sessionIdSchema = z.object({ [NOTIFY_DATA_SESSION_KEY]: z.string().min(1) })

const routineSchema = z.object({ [NOTIFY_DATA_ROUTINE_KEY]: z.string().min(1) })

const presentedSchema = z.object({
  [NOTIFY_DATA_SESSION_KEY]: z.string().min(1),
  [NOTIFY_DATA_SEQ_KEY]: z.number().int().nonnegative(),
})

const trackSchema = z.object({
  [NOTIFY_DATA_SESSION_KEY]: z.string().min(1),
  [NOTIFY_DATA_SEQ_KEY]: z.number().int().nonnegative(),
  [NOTIFY_DATA_MOMENT_KEY]: z.enum(ENotifyMoment),
  [NOTIFY_DATA_SENT_AT_KEY]: z.string().min(1).optional(),
})

export type PresentedNotification = { identifier: string; sessionId: string; seq: number }

export type NotificationTrackData = {
  sessionId: string
  seq: number
  moment: ENotifyMoment
  sentAt?: string | undefined
}

export const trackDataOf = (data: unknown): NotificationTrackData | null => {
  const parsed = trackSchema.safeParse(data)
  if (!parsed.success) return null
  return {
    sessionId: parsed.data[NOTIFY_DATA_SESSION_KEY],
    seq: parsed.data[NOTIFY_DATA_SEQ_KEY],
    moment: parsed.data[NOTIFY_DATA_MOMENT_KEY],
    ...(parsed.data[NOTIFY_DATA_SENT_AT_KEY] === undefined
      ? {}
      : { sentAt: parsed.data[NOTIFY_DATA_SENT_AT_KEY] }),
  }
}

export const trackEventOfAction = (actionIdentifier: string): ENotifyTrackEvent | null => {
  if (actionIdentifier === NOTIFICATION_OPEN_ACTION) return ENotifyTrackEvent.Opened
  if (actionIdentifier === NOTIFICATION_DISMISS_ACTION) return ENotifyTrackEvent.Dismissed
  return null
}

export const notificationTrackOf = (notice: AtlasNotification) => ({
  event: ENotifyTrackEvent.InAppShown,
  sessionId: notice.sessionId,
  seq: notice.seq,
  moment: notice.moment,
  deviceKind: ENotifyInAppKind.Ios,
})

export const sessionIdOfData = (data: unknown): string | undefined => {
  if (routineSchema.safeParse(data).success) return undefined
  const parsed = sessionIdSchema.safeParse(data)
  return parsed.success ? parsed.data[NOTIFY_DATA_SESSION_KEY] : undefined
}

export const presentedNotificationOf = (args: {
  identifier: string
  data: unknown
}): PresentedNotification | null => {
  const parsed = presentedSchema.safeParse(args.data)
  if (!parsed.success) return null
  return {
    identifier: args.identifier,
    sessionId: parsed.data[NOTIFY_DATA_SESSION_KEY],
    seq: parsed.data[NOTIFY_DATA_SEQ_KEY],
  }
}

export const readDismissalIdsOf = (args: {
  presented: readonly PresentedNotification[]
  readSeqs: ReadonlyMap<string, number>
}): string[] =>
  args.presented.flatMap((entry) => {
    const readSeq = args.readSeqs.get(entry.sessionId)
    return readSeq !== undefined && readSeq >= entry.seq ? [entry.identifier] : []
  })
