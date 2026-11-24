import {
  blockingCommandOf,
  type BlockingCommand,
  isSessionWorking,
  stagedPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { queuedRowsOf, type QueuedRow } from './queued-rows'
import type { StagedSend } from './staged-send'

export type QueuedDockState = {
  rows: QueuedRow[]
  blocking: BlockingCommand | undefined
}

export const QUEUED_LABEL = 'Queued'

export const queuedLabelOf = (dock: Pick<QueuedDockState, 'blocking'>): string =>
  dock.blocking === undefined ? QUEUED_LABEL : dock.blocking.copy.queued

export const queuedDockOf = (args: {
  snapshot: Pick<SessionSnapshot, 'pending' | 'events' | 'status'>
  staged: readonly StagedSend[]
  now: number
}): QueuedDockState => {
  const placement = stagedPlacementOf({
    staged: args.staged,
    events: args.snapshot.events,
    working: isSessionWorking(args.snapshot.status),
  })
  return {
    rows: queuedRowsOf({
      pending: args.snapshot.pending,
      events: transcriptEventsOf(args.snapshot.events),
      staged: placement.queue,
      now: args.now,
    }),
    blocking: blockingCommandOf(args.snapshot.status),
  }
}
