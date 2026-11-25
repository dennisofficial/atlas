import {
  INBOX_KIND_EVENT,
  inboxEventOf,
  pendingInputsOf,
  type EventDraft,
  type InboxEntry,
  type RecordEvent,
} from '@dltech/atlas-core'

const heldFlagOf = (input: EventDraft): boolean =>
  input.type === 'agent-ended' && input.held === true

export const heldEndingIdsOf = (args: {
  entries: readonly InboxEntry[]
  recordEvents: readonly RecordEvent[]
  childrenRunning: number
}): ReadonlySet<number> => {
  const ids = new Set<number>()
  if (args.childrenRunning === 0) return ids

  for (const entry of args.entries) {
    if (entry.kind !== INBOX_KIND_EVENT) continue
    const read = inboxEventOf(entry.payload)
    if (read.ok && heldFlagOf(read.event)) ids.add(entry.inboxId)
  }
  for (const pendingInput of pendingInputsOf(args.recordEvents).pending) {
    if (pendingInput.event !== undefined && heldFlagOf(pendingInput.event)) {
      ids.add(pendingInput.inboxId)
    }
  }
  return ids
}
