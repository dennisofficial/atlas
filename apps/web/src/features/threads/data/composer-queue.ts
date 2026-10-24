import { EMessageOrigin } from '@dltech/atlas-core'
import type { QueuedMessage } from '@dltech/atlas-ui/ai/task-dock'
import type { PendingEntryWire } from '@dltech/atlas-wire/web'

export const TOO_LATE_NOTICE = 'Atlas already started on that message.'
export const QUEUE_PLACEHOLDER = 'Queue a message for when Atlas is done…'

const isTakeBackable = (entry: PendingEntryWire): boolean =>
  !entry.reserved && (entry.via === undefined || entry.via === EMessageOrigin.Operator)

export const takeBackableIdOf = (pending: readonly PendingEntryWire[]): string | null =>
  pending.findLast(isTakeBackable)?.id ?? null

export const queuedOf = (pending: readonly PendingEntryWire[]): QueuedMessage[] => {
  const removableId = takeBackableIdOf(pending)
  return pending.map((entry) => ({
    id: entry.id,
    text: entry.text,
    removable: entry.id === removableId,
  }))
}
