import { NOTIFICATION_OPEN_ACTION } from './action-identifiers'
import { sessionIdOfData } from './notification-data'

export type TNotificationTap = { identifier: string; data: unknown; actionIdentifier?: string }

export const claimSessionTap = (args: {
  handled: Set<string>
  tap: TNotificationTap
}): string | undefined => {
  if (
    args.tap.actionIdentifier !== undefined &&
    args.tap.actionIdentifier !== NOTIFICATION_OPEN_ACTION
  )
    return undefined
  if (args.handled.has(args.tap.identifier)) return undefined
  const sessionId = sessionIdOfData(args.tap.data)
  if (sessionId === undefined) return undefined
  args.handled.add(args.tap.identifier)
  return sessionId
}
