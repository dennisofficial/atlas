import { isTurnTaking, type Event } from '@dltech/atlas-core'

import type { StepFailure } from './transcript-snapshot'

export function persistedFailureOf(events: readonly Event[]): StepFailure | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn-failed') return { message: event.message }
    if (isTurnTaking(event)) return null
  }
  return null
}
