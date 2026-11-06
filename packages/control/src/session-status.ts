import {
  blobValueOf,
  isBlobRef,
  sessionStatusOf,
  type InboxEntry,
  type V2Event,
} from '@dltech/atlas-core'
import {
  INBOX_KIND_MESSAGE,
  inboxMessageSchema,
  QUEUED_MESSAGES_LIMIT,
  type SessionQueuedMessage,
  type SessionStatusOutput,
} from '@dltech/atlas-protocol'

import type { ControlPlane } from './control-plane'

export const STATUS_EVENT_LIMIT = 1000

export type StatusPlane = Pick<ControlPlane, 'readStatusSnapshot' | 'readBlob'>

export type SessionStatusRead = { at: number; value: SessionStatusOutput }

const resolveFactRefs = (args: {
  plane: StatusPlane
  events: readonly V2Event[]
}): Promise<V2Event[]> =>
  Promise.all(
    args.events.map(async (event) => {
      if (event.type !== 'fact-recorded' || !isBlobRef(event.value)) return event
      const blob = await args.plane.readBlob({ hash: event.value.$blob.hash })
      if (blob === undefined) return event
      return { ...event, value: blobValueOf(blob.bytes) }
    }),
  )

const queuedOf = (inbox: readonly InboxEntry[]): SessionQueuedMessage[] =>
  inbox
    .filter((entry) => entry.kind === INBOX_KIND_MESSAGE)
    .flatMap((entry) => {
      const parsed = inboxMessageSchema.safeParse(safeJson(entry.payload))
      if (!parsed.success) return []
      return [{ inboxId: entry.inboxId, text: parsed.data.text, postedAt: entry.postedAt }]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)

const safeJson = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

export const readSessionStatus = async (args: {
  plane: StatusPlane
  sessionId: string
  threadId: string
  now: string
}): Promise<SessionStatusRead> => {
  const { plane, sessionId, threadId } = args
  const snapshot = await plane.readStatusSnapshot({
    sessionId,
    threadId,
    eventLimit: STATUS_EVENT_LIMIT,
  })
  const events = await resolveFactRefs({ plane, events: snapshot.events })
  const { head, lease, live } = snapshot
  const current = sessionStatusOf({
    events,
    live,
    unconsumedInbox: snapshot.unconsumedInbox,
    messageAfterFailure: snapshot.messageAfterFailure,
    now: args.now,
  })
  const queued = queuedOf(snapshot.pendingInbox)
  const lastSeq = events[events.length - 1]?.seq ?? 0
  return {
    at: Math.max(head.seq, lastSeq),
    value: {
      state: current.state,
      ...(current.reason === undefined ? {} : { reason: current.reason }),
      ...(current.since === undefined ? {} : { since: current.since }),
      lease: { epoch: lease.epoch, holderHostId: lease.holderHostId, live },
      ...(queued.length === 0 ? {} : { queued }),
    },
  }
}
