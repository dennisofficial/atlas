import {
  deliveredDraftOf,
  owedNotices,
  type Event,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PrEventAck } from './pr-event-notice'
import type { ReadyQueue } from './ready-queue'

type AckablePrEvent = Extract<EventDraft, { type: 'pr-event' }> & { eventId: string }

export const isAckablePrEvent = (draft: EventDraft): draft is AckablePrEvent =>
  draft.type === 'pr-event' && draft.eventId !== undefined

const owedPrEventDrafts = (args: { threadId: ThreadId; events: readonly Event[] }): EventDraft[] =>
  owedNotices(args.events)
    .filter((event) => event.type === 'pr-event' && event.threadId === args.threadId)
    .flatMap((event) => {
      const draft = deliveredDraftOf(event)
      return draft === undefined ? [] : [draft]
    })

/**
 * Owns the pr-event durability seam of the subscription registry: an event carrying a mailbox id
 * is journaled `arrived` before it batches and acked to the API once the append returns (a failed
 * append leaves the row unacked so the replay lease re-serves it); on thread load, journaled
 * arrivals the intake never delivered re-enter the ready queue so they drain at the next model
 * boundary.
 */
export class PrEventIntake {
  constructor(
    private readonly args: {
      log: EventLogPort
      ids: IdPort
      queue: ReadyQueue
      ack: PrEventAck | undefined
      warn: (message: string) => void
      changed: () => void
    },
  ) {}

  journalArrival({ threadId, draft }: { threadId: ThreadId; draft: AckablePrEvent }): void {
    const eventId = draft.eventId
    void this.args.log
      .append({ threadId, runId: this.args.ids.nextRunId(), drafts: [draft] })
      .then(() => this.args.ack?.({ threadId, eventIds: [eventId] }))
      .catch((cause: unknown) =>
        this.args.warn(
          `could not journal a pr-event arrival for ${threadId}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
      )
  }

  requeueOwed({ threadId, events }: { threadId: ThreadId; events: readonly Event[] }): void {
    const drafts = owedPrEventDrafts({ threadId, events })
    if (drafts.length === 0) return
    this.args.queue.enqueue({ threadId, subscriptionId: '', drafts })
    this.args.changed()
  }
}
