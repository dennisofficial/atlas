import {
  queuedMessagesOf,
  queuedNoticesOf,
  stagedQueuedMessagesOf,
  type QueuedMessage,
  type QueuedNoticeEntry,
} from '@dltech/atlas-client/session'
import {
  blockingCommandOf,
  type BlockingCommand,
  isSessionWorking,
  stagedPlacementOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import type { StagedSend } from './staged-send'

export type QueuedDockState = {
  messages: QueuedMessage[]
  notices: QueuedNoticeEntry[]
  stagedIds: ReadonlySet<string>
  blocking: BlockingCommand | undefined
}

export const QUEUED_LABEL = 'Queued'

export const queuedLabelOf = (dock: Pick<QueuedDockState, 'blocking'>): string =>
  dock.blocking === undefined ? QUEUED_LABEL : dock.blocking.copy.queued

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
    blocking: blockingCommandOf(args.snapshot.status),
  }
}
