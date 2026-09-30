import { awaitsReply, pendingCalls, type CallId, type Event, type ThreadId } from '@dltech/atlas-core'

import type { SettlePending } from './settle-pending'
import { stalledReport } from './turn-faults'

export function messageArrivedSince({
  events,
  seenThrough,
}: {
  events: readonly Event[]
  seenThrough: number | undefined
}): boolean {
  if (seenThrough === undefined) return false
  return awaitsReply(events.filter((event) => event.seq > seenThrough && event.type !== 'assistant-said'))
}

export function committedSinceLastMessage(events: readonly Event[]): boolean {
  const spokenTo = events.findLastIndex((event) => event.type === 'user-said')

  return events
    .slice(spokenTo + 1)
    .some(
      (event) =>
        event.type === 'tool-called' ||
        (event.type === 'assistant-said' && event.parts.some((part) => part.type === 'text')),
    )
}

export type SettledOutcome =
  | { kind: 'none-pending' }
  | { kind: 'settled' }
  | { kind: 'interrupted' }
  | { kind: 'paused'; callId: CallId; reason: string }
  | { kind: 'stalled'; message: string; cause: unknown }

/**
 * Settles the log's first unanswered tool call, if any. `none-pending` leaves the turn to its
 * next step; `settled` restarts the iteration so the settled result is re-read; `paused` hands
 * the call to the operator; `stalled` fails the turn rather than retrying a call dispatch
 * already left pending; `interrupted` means the operator stopped the turn mid-settle.
 */
export async function settlePendingCall({
  owned,
  threadId,
  settlePending,
  settleAttempted,
  signal,
}: {
  owned: readonly Event[]
  threadId: ThreadId
  settlePending: SettlePending | undefined
  settleAttempted: CallId | undefined
  signal: AbortSignal
}): Promise<SettledOutcome> {
  const pending = pendingCalls(owned)[0]
  if (pending === undefined) return { kind: 'none-pending' }

  if (settlePending === undefined) {
    return { kind: 'paused', callId: pending.callId, reason: `awaiting ${pending.name}` }
  }
  if (pending.callId === settleAttempted) {
    return { kind: 'stalled', message: stalledReport(pending), cause: pending }
  }

  const settled = await settlePending({ threadId, signal })
  if (settled.paused !== undefined) return { kind: 'paused', ...settled.paused }
  if (signal.aborted) return { kind: 'interrupted' }
  return { kind: 'settled' }
}
