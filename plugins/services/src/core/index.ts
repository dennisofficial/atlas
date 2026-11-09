import { serviceReadySchema } from './ready-event'
import { servicesView } from './roster'

export * from './declared'
export * from './ready-event'
export * from './roster'

export const servicesCoreSlots = {
  events: [serviceReadySchema],
  views: [servicesView],
  commands: [] as readonly never[],
} as const
