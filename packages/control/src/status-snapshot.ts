import {
  activeFailure,
  activeStartFailure,
  INBOX_KIND_STOP,
  type InboxEntry,
  type Lease,
  type LogHead,
  type V2Event,
} from '@dltech/atlas-core'

import { UnknownThreadError } from './errors'
import type { LeaseOps } from './lease-ops'
import type { ControlTx } from './port'
import { readEventsIn } from './read-events'

export type StatusSnapshot = {
  head: LogHead
  events: V2Event[]
  unconsumedInbox: boolean
  pendingInbox: InboxEntry[]
  messageAfterFailure: boolean
  lease: Lease
  live: boolean
}

export const PENDING_INBOX_READ_LIMIT = 100

export const readStatusSnapshotIn = async (params: {
  tx: ControlTx
  leases: LeaseOps
  sessionId: string
  threadId: string
  eventLimit: number
}): Promise<StatusSnapshot> => {
  const { tx, sessionId, threadId } = params
  await tx.useSnapshot()
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const page = await readEventsIn({
    tx,
    row,
    afterSeq: Math.max(0, row.headSeq - params.eventLimit),
    limit: params.eventLimit,
    visible: true,
  })
  const pending = await tx.readInboxEntries({
    sessionId,
    afterId: 0,
    limit: PENDING_INBOX_READ_LIMIT,
  })
  const { lease, live } = await params.leases.currentLeaseIn({ tx, sessionId })
  const failure = activeStartFailure(page.events) ?? activeFailure(page.events)
  const messageAfterFailure =
    failure !== undefined &&
    (
      await tx.readInboxEntries({
        sessionId,
        afterId: failure.inboxHead,
        limit: 1,
        excludeKind: INBOX_KIND_STOP,
      })
    ).length > 0
  return {
    head: { seq: row.headSeq, hash: row.headHash },
    events: page.events,
    unconsumedInbox: pending.length > 0,
    pendingInbox: pending,
    messageAfterFailure,
    lease,
    live,
  }
}
