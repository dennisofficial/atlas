import type { WireEvent } from '@dltech/atlas-wire/web'

import { headOf } from './live-events'

export type EventsSnapshot = { events: WireEvent[]; head: number; historyRev?: number }
export type EventsCheckpoint = { head: number; historyRev?: number }
export type EventsBatch = EventsCheckpoint & { fromSeq: number; events: WireEvent[] }
export type SnapshotFetcher = (args: {
  threadId: string
  fromSeq?: number | undefined
}) => Promise<EventsSnapshot>

export const eventsSnapshot = (value: WireEvent[] | EventsSnapshot): EventsSnapshot =>
  Array.isArray(value) ? { events: value, head: headOf(value) } : value
