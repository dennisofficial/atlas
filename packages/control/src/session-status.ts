import {
  activeFailure,
  activeStartFailure,
  blobValueOf,
  INBOX_KIND_STOP,
  isBlobRef,
  sessionStatusOf,
  type V2Event,
} from '@dltech/atlas-core'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'

import type { ControlPlane } from './control-plane'

export const STATUS_EVENT_LIMIT = 1000

export type StatusPlane = Pick<
  ControlPlane,
  'head' | 'readEvents' | 'readInbox' | 'currentLease' | 'readBlob' | 'hasMessageAfter'
>

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

export const readSessionStatus = async (args: {
  plane: StatusPlane
  sessionId: string
  threadId: string
  now: string
}): Promise<SessionStatusRead> => {
  const { plane, sessionId, threadId } = args
  const head = await plane.head({ threadId })
  const [page, unconsumed, { lease, live }] = await Promise.all([
    plane.readEvents({
      threadId,
      afterSeq: Math.max(0, head.seq - STATUS_EVENT_LIMIT),
      limit: STATUS_EVENT_LIMIT,
      visible: true,
    }),
    plane.readInbox({ sessionId, afterId: 0, limit: 1 }).then((entries) => entries.length > 0),
    plane.currentLease({ sessionId }),
  ])
  const events = await resolveFactRefs({ plane, events: page.events })
  const failure = activeStartFailure(events) ?? activeFailure(events)
  const messageAfterFailure =
    failure !== undefined &&
    (await plane.hasMessageAfter({
      sessionId,
      afterId: failure.inboxHead,
      excludeKind: INBOX_KIND_STOP,
    }))
  const current = sessionStatusOf({
    events,
    live,
    unconsumedInbox: unconsumed,
    messageAfterFailure,
    now: args.now,
  })
  const lastSeq = events[events.length - 1]?.seq ?? 0
  return {
    at: Math.max(head.seq, lastSeq),
    value: {
      state: current.state,
      ...(current.reason === undefined ? {} : { reason: current.reason }),
      ...(current.since === undefined ? {} : { since: current.since }),
      lease: { epoch: lease.epoch, holderHostId: lease.holderHostId, live },
    },
  }
}
