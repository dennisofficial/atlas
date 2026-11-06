import { blobValueOf, isBlobRef, sessionStatusOf, type V2Event } from '@dltech/atlas-core'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'

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
