import {
  queuedMessagesOf,
  queuedNoticesOf,
  stagedQueuedMessagesOf,
  type QueuedMessage,
  type QueuedNoticeEntry,
} from '@dltech/atlas-client/session'
import {
  isSessionWorking,
  stagedPlacementOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import type { StagedSend } from './staged-send'

export type QueuedDockState = {
  messages: QueuedMessage[]
  notices: QueuedNoticeEntry[]
  stagedIds: ReadonlySet<string>
}

export const queuedDockOf = (args: {
  snapshot: Pick<SessionSnapshot, 'pending' | 'events' | 'status'>
  staged: readonly StagedSend[]
}): QueuedDockState => {
  const placement = stagedPlacementOf({
    staged: args.staged,
    events: args.snapshot.events,
    working: isSessionWorking(args.snapshot.status),
  })
  const staged = stagedQueuedMessagesOf(placement.queue)
  return {
    messages: [...queuedMessagesOf(args.snapshot.pending), ...staged],
    notices: queuedNoticesOf(args.snapshot.pending),
    stagedIds: new Set(staged.map((message) => message.id)),
  }
}
