import { COMMAND_OUTCOME_EVENT_TYPES, type RecordEvent } from '@dltech/atlas-core'
import { ECommandState } from '@dltech/atlas-protocol'

import { type BlockingCommand, blockingCommandOf, blockingCopyOf } from './blocking-command'
import type { SessionSnapshot } from './session-follower'

type Status = SessionSnapshot['status']

export type RequestedCommand = {
  readonly name: string
  readonly requestedAt: string
  readonly inboxId: number | undefined
}

export const requestedCommandOf = (args: { name: string; now: number }): RequestedCommand => ({
  name: args.name,
  requestedAt: new Date(args.now).toISOString(),
  inboxId: undefined,
})

export const acceptedCommandOf = (args: {
  current: RequestedCommand | undefined
  requested: RequestedCommand
  inboxId: number
}): RequestedCommand | undefined =>
  args.current === args.requested ? { ...args.requested, inboxId: args.inboxId } : args.current

export const failedCommandOf = (args: {
  current: RequestedCommand | undefined
  requested: RequestedCommand
}): RequestedCommand | undefined => (args.current === args.requested ? undefined : args.current)

const listedRowOf = (args: { requested: RequestedCommand; status: Status }) => {
  const { requested, status } = args
  if (requested.inboxId === undefined) return undefined
  return status?.commands?.find((row) => row.inboxId === requested.inboxId)
}

const endsCommand = (event: RecordEvent): boolean =>
  event.type === 'input-refused' || COMMAND_OUTCOME_EVENT_TYPES.has(event.type)

const inboxIdOf = (event: RecordEvent): number | undefined =>
  'inboxId' in event && typeof event.inboxId === 'number' ? event.inboxId : undefined

export const requestedCommandDone = (args: {
  requested: RequestedCommand
  status: Status
  events: readonly RecordEvent[]
}): boolean => {
  const { requested, events } = args
  if (requested.inboxId === undefined) return false
  if (listedRowOf(args) !== undefined) return false
  return events.some((event) => endsCommand(event) && inboxIdOf(event) === requested.inboxId)
}

const earlierOf = (left: string, right: string): string =>
  Date.parse(left) <= Date.parse(right) ? left : right

export const shownBlockingOf = (args: {
  requested: RequestedCommand | undefined
  status: Status
}): BlockingCommand | undefined => {
  const { requested, status } = args
  const listed = blockingCommandOf(status)
  if (requested === undefined) return listed
  const row = listedRowOf({ requested, status })
  if (row?.state === ECommandState.Queued) return listed
  if (listed !== undefined && listed.inboxId === requested.inboxId) {
    return { ...listed, startedAt: earlierOf(listed.startedAt, requested.requestedAt) }
  }
  if (listed !== undefined) return listed
  const copy = blockingCopyOf(requested.name)
  if (copy === undefined) return undefined
  return {
    inboxId: requested.inboxId,
    name: requested.name,
    startedAt: requested.requestedAt,
    copy,
  }
}
