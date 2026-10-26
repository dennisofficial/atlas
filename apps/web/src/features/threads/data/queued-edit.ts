import { EPendingEdit } from '@dltech/atlas-wire/web'
import {
  removePendingEntry,
  updatePendingEntry,
  type RemoteDeltaChannel,
} from '@dltech/atlas-client/channel'

import { TOO_LATE_NOTICE } from './composer-queue'

type QueueChannel = Pick<RemoteDeltaChannel, 'request'>

export const NOT_CONNECTED_NOTICE = 'The sandbox is not connected. Try again in a moment.'
export const RESERVED_NOTICE = 'Atlas is already picking that message up.'
export const NOT_EDITABLE_NOTICE = 'Only messages you queued can be changed.'

const NOTICE_OF: Record<EPendingEdit, string | null> = {
  [EPendingEdit.Done]: null,
  [EPendingEdit.Missing]: TOO_LATE_NOTICE,
  [EPendingEdit.Reserved]: RESERVED_NOTICE,
  [EPendingEdit.NotEditable]: NOT_EDITABLE_NOTICE,
}

export const queuedEditNoticeOf = (outcome: EPendingEdit): string | null => NOTICE_OF[outcome]

export async function saveQueuedEntry(args: {
  channel: QueueChannel | null
  threadId: string
  id: string
  text: string
}): Promise<string | null> {
  if (args.channel === null) return NOT_CONNECTED_NOTICE
  const reply = await updatePendingEntry({ ...args, channel: args.channel })
  return queuedEditNoticeOf(reply.outcome)
}

export async function removeQueuedEntry(args: {
  channel: QueueChannel
  threadId: string
  id: string
}): Promise<string | null> {
  const reply = await removePendingEntry(args)
  return queuedEditNoticeOf(reply.outcome)
}
