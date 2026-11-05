import { isTurnTaking } from '../agents/kind'
import type { Event } from './envelope'
import { isNoticeDelivery } from './notice-stage'

const answers = (event: Event): boolean =>
  event.type === 'assistant-said' ||
  ((event.type === 'tool-result' || event.type === 'tool-denied') && event.interrupted === true)

export function awaitsPulledInput(events: readonly Event[]): boolean {
  const last = events.filter((event) => isTurnTaking(event) && !isNoticeDelivery(event)).at(-1)
  return last !== undefined && !answers(last)
}
