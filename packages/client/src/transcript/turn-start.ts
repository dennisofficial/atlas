import {
  ESessionStatus,
  openTurnOf,
  type SessionStatus,
  type RecordEvent,
} from '@dltech/atlas-core'

export const turnStartedAtOf = (args: {
  events: readonly RecordEvent[]
  status?: SessionStatus | undefined
}): string | undefined => {
  const open = openTurnOf(args.events.filter((event) => event.depth === 0))?.startedAt
  if (open !== undefined) return open
  return args.status?.state === ESessionStatus.Queued ? args.status.since : undefined
}
