import { openTurnOf, type V2Event } from '@dltech/atlas-core'

export const turnStartedAtOf = (events: readonly V2Event[]): string | undefined =>
  openTurnOf(events.filter((event) => event.depth === 0))?.startedAt
