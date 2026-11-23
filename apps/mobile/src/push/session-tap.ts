import { sessionIdOfData } from './notification-data'

export type TNotificationTap = { identifier: string; data: unknown }

export const claimSessionTap = (args: {
  handled: Set<string>
  tap: TNotificationTap
}): string | undefined => {
  if (args.handled.has(args.tap.identifier)) return undefined
  const sessionId = sessionIdOfData(args.tap.data)
  if (sessionId === undefined) return undefined
  args.handled.add(args.tap.identifier)
  return sessionId
}
