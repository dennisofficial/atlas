import { ENotifyMoment } from '@dltech/atlas-core'
import { z } from 'zod'

export enum EMacPush {
  Clear = 'clear',
  Notification = 'notification',
}

export type MacPush =
  | { kind: EMacPush.Clear; sessionId: string }
  | {
      kind: EMacPush.Notification
      sessionId: string
      seq: number
      moment?: ENotifyMoment | undefined
      sentAt?: string | undefined
    }

const clearSchema = z.object({ clearSessionId: z.string().min(1) })

const notificationSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  moment: z.enum(ENotifyMoment).optional(),
  sentAt: z.string().min(1).optional(),
})

export const macPushOf = (userInfo: unknown): MacPush | null => {
  const clear = clearSchema.safeParse(userInfo)
  if (clear.success) return { kind: EMacPush.Clear, sessionId: clear.data.clearSessionId }
  const notification = notificationSchema.safeParse(userInfo)
  return notification.success
    ? {
        kind: EMacPush.Notification,
        sessionId: notification.data.sessionId,
        seq: notification.data.seq,
        ...(notification.data.moment === undefined ? {} : { moment: notification.data.moment }),
        ...(notification.data.sentAt === undefined ? {} : { sentAt: notification.data.sentAt }),
      }
    : null
}

export type MacNotificationEntry = { groupId?: string | undefined }

export const groupsToRemove = (args: {
  history: readonly MacNotificationEntry[]
  sessionId?: string | undefined
  readSessionIds?: readonly string[] | undefined
}): string[] => {
  const wanted = new Set(
    args.sessionId === undefined ? (args.readSessionIds ?? []) : [args.sessionId],
  )
  const groups = args.history.flatMap((entry) =>
    entry.groupId === undefined ? [] : [entry.groupId],
  )
  return [...new Set(groups.filter((groupId) => wanted.has(groupId)))]
}
