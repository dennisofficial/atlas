import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'
import type { SessionQueuedMessage } from '@dltech/atlas-protocol'
import type { V2Event } from '@dltech/atlas-core'

const INBOX_REQUEST_PREFIX = 'inbox:'

export const consumedInboxIdsOf = (events: readonly V2Event[]): ReadonlySet<number> => {
  const ids = new Set<number>()
  for (const event of events) {
    if (event.type !== 'user-said' || event.requestId === undefined) continue
    if (!event.requestId.startsWith(INBOX_REQUEST_PREFIX)) continue
    const id = Number(event.requestId.slice(INBOX_REQUEST_PREFIX.length))
    if (Number.isInteger(id)) ids.add(id)
  }
  return ids
}

export const visibleQueuedOf = (args: {
  queued: readonly SessionQueuedMessage[] | undefined
  events: readonly V2Event[]
}): QueuedMessageEntry[] => {
  const consumed = consumedInboxIdsOf(args.events)
  return (args.queued ?? [])
    .filter((message) => !consumed.has(message.inboxId))
    .map((message) => ({ id: String(message.inboxId), text: message.text, attachments: [] }))
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
