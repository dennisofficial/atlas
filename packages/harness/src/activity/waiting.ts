import { projectWaiting, type Event, type WaitingForModel } from '@dltech/atlas-core'

export const isWaitingEvent = (event: Event): boolean =>
  event.type === 'model-waiting' || event.type === 'model-wait-cleared'

export const currentWaiting = (events: readonly Event[]): WaitingForModel | null =>
  projectWaiting(events.filter(isWaitingEvent))[0] ?? null
