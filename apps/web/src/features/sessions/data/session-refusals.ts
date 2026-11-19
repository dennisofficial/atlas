import type { V2Event } from '@dltech/atlas-core'

export type SessionRefusal = { inboxId: number; reason: string }

// A successful input or a turn starting means the operator has moved on: anything refused
// before that is spent and must not stay stacked above the composer.
const CLEARING_TYPES: ReadonlySet<string> = new Set(['user-said', 'nudge', 'assistant-said'])

export const sessionRefusalsOf = (events: readonly V2Event[], limit = 20): SessionRefusal[] => {
  const clearedAt = events.reduce(
    (seq, event) => (CLEARING_TYPES.has(event.type) ? event.seq : seq),
    0,
  )
  return events
    .flatMap((event) =>
      event.type === 'input-refused' && event.reason !== '' && event.seq > clearedAt
        ? [{ inboxId: event.inboxId, reason: event.reason }]
        : [],
    )
    .slice(-limit)
}
