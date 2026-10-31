import type { Event, RunFailure, RunId } from '@dltech/atlas-core'

export type DurableRunFailure = { failure: RunFailure; runId: RunId; seq?: number | undefined }

export type LegacyFailure = { message: string; seq: number }

const supersedesFailure = (event: Event): boolean =>
  event.type === 'user-said' || event.type === 'assistant-said'

const dismissedSeqs = (events: readonly Event[]): ReadonlySet<number> =>
  new Set(
    events.flatMap((event) => (event.type === 'run-failure-dismissed' ? [event.failureSeq] : [])),
  )

function liveAfter(args: { events: readonly Event[]; seq: number }): boolean {
  return !args.events.some((event) => event.seq > args.seq && supersedesFailure(event))
}

export function latestRunFailure(events: readonly Event[]): DurableRunFailure | null {
  let latest: DurableRunFailure | null = null
  let latestSeq = 0

  for (const event of events) {
    if (event.type === 'run-failed' && event.seq >= latestSeq) {
      latest = { failure: event.failure, runId: event.runId, seq: event.seq }
      latestSeq = event.seq
    }
  }

  if (latest === null) return null
  if (dismissedSeqs(events).has(latestSeq)) return null
  return liveAfter({ events, seq: latestSeq }) ? latest : null
}

export function legacyFailureOf(events: readonly Event[]): LegacyFailure | null {
  let latest: LegacyFailure | null = null
  for (const event of events) {
    if (event.type === 'turn-failed' && (latest === null || event.seq >= latest.seq)) {
      latest = { message: event.message, seq: event.seq }
    }
  }
  if (latest === null) return null
  if (dismissedSeqs(events).has(latest.seq)) return null
  return liveAfter({ events, seq: latest.seq }) ? latest : null
}

export function failureDismissedForTail(events: readonly Event[]): boolean {
  let latestSeq = 0
  for (const event of events) {
    if ((event.type === 'run-failed' || event.type === 'turn-failed') && event.seq >= latestSeq) {
      latestSeq = event.seq
    }
  }
  return (
    latestSeq > 0 && dismissedSeqs(events).has(latestSeq) && liveAfter({ events, seq: latestSeq })
  )
}
