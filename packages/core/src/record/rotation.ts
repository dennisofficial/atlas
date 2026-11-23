import type { Event, EventOfType } from '../events/envelope'

export const NO_ROTATION = 0

export function latestRotationOf(events: readonly Event[]): EventOfType<'rotated'> | undefined {
  return events.findLast((event) => event.type === 'rotated')
}

export function rotationStartSeq(events: readonly Event[]): number {
  return latestRotationOf(events)?.seq ?? NO_ROTATION
}

export function projectedEvents(events: readonly Event[]): readonly Event[] {
  const from = rotationStartSeq(events)
  return from === NO_ROTATION ? events : events.filter((event) => event.seq >= from)
}
