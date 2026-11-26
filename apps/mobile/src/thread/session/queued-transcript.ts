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

export type QueuedTranscript = {
  rows: QueuedRow[]
  blocking: BlockingCommand | undefined
}

const NO_IDS: ReadonlySet<number> = new Set()

export const QUEUED_LABEL = 'Queued'

export const QUEUED_ROW_OPACITY = 0.5

export const queuedLabelOf = (queued: Pick<QueuedTranscript, 'blocking'>): string =>
  queued.blocking === undefined ? QUEUED_LABEL : queued.blocking.copy.queued

export const queuedTranscriptOf = (args: {
  snapshot: Pick<SessionSnapshot, 'pending' | 'events' | 'status'>
  staged: readonly StagedSend[]
  now: number
  hiddenInboxIds?: ReadonlySet<number> | undefined
}): QueuedTranscript => {
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
      hiddenInboxIds: args.hiddenInboxIds ?? NO_IDS,
    }),
    blocking: blockingCommandOf(args.snapshot.status),
  }
}
