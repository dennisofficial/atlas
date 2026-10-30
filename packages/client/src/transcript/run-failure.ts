import type { Event, RunFailure, RunId } from '@dltech/atlas-core'

export type DurableRunFailure = { failure: RunFailure; runId: RunId }

const supersedesFailure = (event: Event): boolean =>
  event.type === 'user-said' || event.type === 'assistant-said'

export function latestRunFailure(events: readonly Event[]): DurableRunFailure | null {
  let latest: DurableRunFailure | null = null
  let latestSeq = 0

  for (const event of events) {
    if (event.type === 'run-failed' && event.seq >= latestSeq) {
      latest = { failure: event.failure, runId: event.runId }
      latestSeq = event.seq
    }
  }

  if (latest === null) return null
  return events.some((event) => event.seq > latestSeq && supersedesFailure(event)) ? null : latest
}
