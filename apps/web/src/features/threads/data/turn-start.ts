import { openTurnOf, type V2Event } from '@dltech/atlas-core'

/** The instant the turn now running began, taken from the main thread's open turn. */
export const turnStartedAtOf = (events: readonly V2Event[]): string | undefined =>
  openTurnOf(events.filter((event) => event.depth === 0))?.startedAt
