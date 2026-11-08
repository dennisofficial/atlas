import type { V2Event } from '@dltech/atlas-core'

export type SessionRefusal = { inboxId: number; reason: string }

export const sessionRefusalsOf = (events: readonly V2Event[], limit = 20): SessionRefusal[] =>
  events
    .flatMap((event) =>
      event.type === 'input-refused' && event.reason !== ''
        ? [{ inboxId: event.inboxId, reason: event.reason }]
        : [],
    )
    .slice(-limit)
