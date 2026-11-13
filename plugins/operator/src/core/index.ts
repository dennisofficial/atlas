import { legacyOperatorEvents } from './request'

export * from './request'

export const operatorCoreSlots = {
  events: legacyOperatorEvents,
  views: [],
  commands: [],
} as const
