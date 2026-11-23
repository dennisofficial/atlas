import { ESessionStatus, openTurnOf, type SessionStatus, type V2Event } from '@dltech/atlas-core'

export const turnStartedAtOf = (args: {
  events: readonly V2Event[]
  status?: SessionStatus | undefined
}): string | undefined => {
  const open = openTurnOf(args.events.filter((event) => event.depth === 0))?.startedAt
  if (open !== undefined) return open
  return args.status?.state === ESessionStatus.Queued ? args.status.since : undefined
}
