import type { Event, EventDraft } from '@dltech/atlas-core'

/**
 * An event without its envelope. The transfer re-stamps every event in the remote store, so the
 * local seq, run and timestamp are the one part of it that must not travel.
 */
export function draftOf(event: Event): EventDraft {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...body } = event
  return body
}

export const draftsOf = (events: readonly Event[]): readonly EventDraft[] => events.map(draftOf)
