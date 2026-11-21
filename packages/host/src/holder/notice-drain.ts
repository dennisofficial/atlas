import {
  INBOX_KIND_RECORD,
  inboxEventOf,
  isTurnTaking,
  type InboxEntry,
  type InputMessage,
  type V2Event,
} from '@dltech/atlas-core'
import { inboxMessageSchema } from '@dltech/atlas-protocol'

import {
  inputMessageOf,
  jsonOf,
  loggedNoticesOf,
  salvagedOf,
  type AppendDrafts,
} from './staged-log'

export type StagedMessage = { entry: InboxEntry; message: InputMessage }

export const drainEventEntry = async (params: {
  entry: InboxEntry
  appendDrafts: AppendDrafts
}): Promise<boolean> => {
  const read = inboxEventOf(params.entry.payload)
  if (!read.ok) {
    await params.appendDrafts([
      { type: 'input-refused', inboxId: params.entry.inboxId, reason: read.reason },
    ])
    return false
  }
  await params.appendDrafts([read.event, { type: 'input-consumed', inboxId: params.entry.inboxId }])
  return params.entry.kind !== INBOX_KIND_RECORD && isTurnTaking(read.event)
}

export const drainRecordEntry = async (params: {
  entry: InboxEntry
  appendDrafts: AppendDrafts
}): Promise<void> => {
  await drainEventEntry(params)
}

export const drainLoggedNotices = async (params: {
  events: readonly V2Event[]
  staged: ReadonlySet<number>
  appendDrafts: AppendDrafts
}): Promise<boolean> => {
  let wakesTurn = false
  for (const notice of loggedNoticesOf({ events: params.events, staged: params.staged })) {
    await params.appendDrafts([notice.event, { type: 'input-consumed', inboxId: notice.inboxId }])
    if (isTurnTaking(notice.event)) wakesTurn = true
  }
  return wakesTurn
}

export const stagedMessageOf = async (params: {
  entry: InboxEntry
  appendDrafts: AppendDrafts
}): Promise<StagedMessage | undefined> => {
  const parsed = inboxMessageSchema.safeParse(jsonOf(params.entry.payload))
  if (!parsed.success) {
    await params.appendDrafts([
      {
        type: 'input-refused',
        inboxId: params.entry.inboxId,
        reason: 'unreadable message',
        ...salvagedOf(params.entry.payload),
      },
    ])
    return undefined
  }
  return {
    entry: params.entry,
    message: inputMessageOf({ entry: params.entry, message: parsed.data }),
  }
}
