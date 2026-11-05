import { isTurnTaking } from '../agents/kind'
import type { Event } from './envelope'
import type { EventId } from './ids'
import { isNoticeDelivery } from './notice-stage'

const answers = (event: Event): boolean =>
  event.type === 'assistant-said' ||
  ((event.type === 'tool-result' || event.type === 'tool-denied') && event.interrupted === true)

const lastInput = (events: readonly Event[]): Event | undefined =>
  events.filter((event) => isTurnTaking(event) && !isNoticeDelivery(event)).at(-1)

export const lastInputId = (events: readonly Event[]): EventId | undefined => lastInput(events)?.id

export function awaitsPulledInput(events: readonly Event[], stoppedAt?: EventId): boolean {
  const last = lastInput(events)
  if (last === undefined || answers(last)) return false
  return last.id !== stoppedAt
}
